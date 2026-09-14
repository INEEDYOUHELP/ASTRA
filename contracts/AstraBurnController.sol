// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.6.0
pragma solidity ^0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAstraStakingBurnSource} from "./interfaces/IAstraStakingBurnSource.sol";
import {IAstraTokenBurn} from "./interfaces/IAstraTokenBurn.sol";
import {MockOracleAdapter} from "./MockOracleAdapter.sol";

/**
 * @title AstraBurnController
 * @notice Keeper 按 epoch 检查 Oracle 指标；条件满足时从社区奖励池销毁一部分 ASTRA。
 *
 * 流程（务必理解）：
 *   1) 运维/Keeper 先向 MockOracleAdapter.setMetrics(...) 写入本周期观测
 *   2) Keeper 调 checkAndBurn()
 *   3) 若：流动性不足 AND 价格偏离过大 AND 本 epoch 未销毁过
 *   4) burnAmount = min(rewardPool × burnBps/10000, maxBurnPerEpoch)
 *   5) 从 Staking 奖励池划转到本合约 → 本合约持 BURNER_ROLE 调用 token.burn
 *
 * 前置授权（部署脚本要做）：
 *   - Token：grantRole(BURNER_ROLE, burnController)
 *   - Staking：setBurnController(burnController)
 */
contract AstraBurnController is AccessControl, ReentrancyGuard {
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant PARAM_SETTER_ROLE = keccak256("PARAM_SETTER_ROLE");

    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// @dev 参数上限：单次最多按奖励池 10% 计（可再被 maxBurnPerEpoch 卡住）
    uint256 public constant MAX_BURN_BPS = 1_000;

    IERC20 public immutable astraToken;
    IAstraTokenBurn public immutable astraTokenBurn;
    IAstraStakingBurnSource public staking;
    MockOracleAdapter public oracle;

    uint256 public epochDuration = 7 days;
    uint256 public minLiquidityAddedETH; // 低于此值视为「LP 新增不足」
    uint256 public maxPriceDeviationBps; // 高于此值视为「价格偏离过大」
    uint256 public burnBps; // 按奖励池比例销毁
    uint256 public maxBurnPerEpoch; // 单 epoch 销毁上限

    uint256 public lastBurnEpoch = type(uint256).max; // 尚未烧过任何 epoch
    uint256 public totalBurned;

    event StakingSet(address indexed staking);
    event OracleSet(address indexed oracle);
    event ParamsUpdated(
        uint256 epochDuration,
        uint256 minLiquidityAddedETH,
        uint256 maxPriceDeviationBps,
        uint256 burnBps,
        uint256 maxBurnPerEpoch
    );
    event BurnExecuted(
        uint256 indexed epoch,
        uint256 burnAmount,
        uint256 netLiquidityAddedETH,
        uint256 priceDeviationBps
    );

    constructor(
        address adminSafe,
        address token_,
        address staking_,
        address oracle_
    ) {
        require(adminSafe != address(0), "adminSafe=0");
        require(token_ != address(0), "token=0");
        require(staking_ != address(0), "staking=0");
        require(oracle_ != address(0), "oracle=0");

        _grantRole(DEFAULT_ADMIN_ROLE, adminSafe);
        _grantRole(KEEPER_ROLE, adminSafe);
        _grantRole(PARAM_SETTER_ROLE, adminSafe);

        astraToken = IERC20(token_);
        astraTokenBurn = IAstraTokenBurn(token_);
        staking = IAstraStakingBurnSource(staking_);
        oracle = MockOracleAdapter(oracle_);
    }

    // -------------------------------------------------------------------------
    // 配置
    // -------------------------------------------------------------------------

    function setStaking(address staking_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(staking_ != address(0), "staking=0");
        staking = IAstraStakingBurnSource(staking_);
        emit StakingSet(staking_);
    }

    function setOracle(address oracle_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(oracle_ != address(0), "oracle=0");
        oracle = MockOracleAdapter(oracle_);
        emit OracleSet(oracle_);
    }

    /**
     * @notice 更新销毁阈值与额度（有上限，防误设过大）
     */
    function setParams(
        uint256 epochDuration_,
        uint256 minLiquidityAddedETH_,
        uint256 maxPriceDeviationBps_,
        uint256 burnBps_,
        uint256 maxBurnPerEpoch_
    ) external onlyRole(PARAM_SETTER_ROLE) {
        require(epochDuration_ > 0, "epochDuration=0");
        require(burnBps_ > 0 && burnBps_ <= MAX_BURN_BPS, "bad burnBps");
        require(maxBurnPerEpoch_ > 0, "maxBurn=0");

        epochDuration = epochDuration_;
        minLiquidityAddedETH = minLiquidityAddedETH_;
        maxPriceDeviationBps = maxPriceDeviationBps_;
        burnBps = burnBps_;
        maxBurnPerEpoch = maxBurnPerEpoch_;

        emit ParamsUpdated(
            epochDuration_,
            minLiquidityAddedETH_,
            maxPriceDeviationBps_,
            burnBps_,
            maxBurnPerEpoch_
        );
    }

    // -------------------------------------------------------------------------
    // 只读
    // -------------------------------------------------------------------------

    function currentEpoch() public view returns (uint256) {
        return block.timestamp / epochDuration;
    }

    /// @notice 预览：若现在调用 checkAndBurn，理论上会烧多少（不含条件判断）
    function previewBurnAmount() public view returns (uint256) {
        uint256 pool = staking.rewardPoolBalance();
        uint256 byBps = (pool * burnBps) / BPS_DENOMINATOR;
        return byBps < maxBurnPerEpoch ? byBps : maxBurnPerEpoch;
    }

    // -------------------------------------------------------------------------
    // Keeper 入口
    // -------------------------------------------------------------------------

    /**
     * @return burned 实际销毁数量；条件不满足或金额为 0 时 revert
     */
    function checkAndBurn()
        external
        onlyRole(KEEPER_ROLE)
        nonReentrant
        returns (uint256 burned)
    {
        require(burnBps > 0 && maxBurnPerEpoch > 0, "params not set");

        uint256 epoch = currentEpoch();
        require(epoch != lastBurnEpoch, "already burned this epoch");

        uint256 netLiq = oracle.netLiquidityAddedETH();
        uint256 deviation = oracle.priceDeviationBps();

        // 触发：LP 新增不足 且 价格偏离过大（README 建议条件）
        require(netLiq < minLiquidityAddedETH, "liquidity ok");
        require(deviation > maxPriceDeviationBps, "price ok");

        burned = previewBurnAmount();
        require(burned > 0, "burn amount=0");

        // 先标记 epoch，再拉币销毁（防同 epoch 重入二次烧）
        lastBurnEpoch = epoch;

        staking.transferForBurn(burned);
        // Token.burn 销毁的是「调用者」余额 → 本合约须持有 BURNER_ROLE
        astraTokenBurn.burn(burned);

        totalBurned += burned;
        emit BurnExecuted(epoch, burned, netLiq, deviation);
    }
}
