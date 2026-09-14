// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.6.0
pragma solidity ^0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAstraReferral} from "./interfaces/IAstraReferral.sol";

/**
 * @title AstraReferral
 * @notice 推荐分佣：用户「首次质押」时可绑定推荐人，推荐人获得首次质押量的 5%（一次性）。
 *
 * 资金流（务必理解）：
 *   1) 用户首次 stake(amount, referrer)
 *   2) AstraStaking 调用本合约 accrueOnFirstStake → 只记账 pending
 *   3) AstraStaking 立刻把 reward 从「社区奖励池」转到本合约托管
 *   4) 推荐人调用 claimReferralReward() 把托管额度转到自己钱包
 *
 * 约束（规格）：
 *   - 禁止自推荐（referrer == user）
 *   - 每个用户只能绑定一次推荐人
 *   - 仅 Staking 合约可调用 accrueOnFirstStake（防止伪造记账）
 */
contract AstraReferral is IAstraReferral, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // 500 / 10000 = 5%
    uint256 public constant REFERRAL_BPS = 500;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    IERC20 public astraToken;
    address public staking; // 唯一允许记账的 Staking 地址
    bool private _tokenSet;
    bool private _stakingSet;

    /// @dev 用户 → 已绑定的推荐人（绑定一次后不可改）
    mapping(address user => address referrer) public referrerOf;

    /// @dev 推荐人 → 待领取的推荐奖励（已从社区池转入本合约）
    mapping(address referrer => uint256 amount) public pendingReward;

    event AstraTokenSet(address indexed token);
    event StakingSet(address indexed staking);
    event ReferralBound(
        address indexed user,
        address indexed referrer,
        uint256 firstStakeAmount,
        uint256 reward
    );
    event ReferralRewardClaimed(address indexed referrer, uint256 amount);

    constructor(address adminSafe) {
        require(adminSafe != address(0), "adminSafe=0");
        _grantRole(DEFAULT_ADMIN_ROLE, adminSafe);
    }

    // -------------------------------------------------------------------------
    // 部署后一次性配置（Admin）
    // -------------------------------------------------------------------------

    function setAstraToken(
        address token
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(!_tokenSet, "token already set");
        require(token != address(0), "token=0");
        astraToken = IERC20(token);
        _tokenSet = true;
        emit AstraTokenSet(token);
    }

    function setStaking(
        address staking_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(!_stakingSet, "staking already set");
        require(staking_ != address(0), "staking=0");
        staking = staking_;
        _stakingSet = true;
        emit StakingSet(staking_);
    }

    // -------------------------------------------------------------------------
    // 由 AstraStaking 在「首次质押」时调用
    // -------------------------------------------------------------------------

    /**
     * @param user 首次质押的用户
     * @param firstStakeAmount 本次首次质押数量
     * @param referrer 推荐人
     * @return reward 记入推荐人 pending 的 5% 奖励（Staking 应随即转入本合约）
     */
    function accrueOnFirstStake(
        address user,
        uint256 firstStakeAmount,
        address referrer
    ) external returns (uint256 reward) {
        require(msg.sender == staking, "only staking");
        require(_tokenSet, "token not set");
        require(user != address(0), "user=0");
        require(referrer != address(0), "referrer=0");
        require(firstStakeAmount > 0, "amount=0");
        require(referrer != user, "self referral"); // 禁止自荐
        require(referrerOf[user] == address(0), "already bound"); // 仅绑定一次

        // reward = firstStakeAmount * 5%
        reward = (firstStakeAmount * REFERRAL_BPS) / BPS_DENOMINATOR;
        require(reward > 0, "reward=0");

        referrerOf[user] = referrer;
        pendingReward[referrer] += reward;

        emit ReferralBound(user, referrer, firstStakeAmount, reward);
    }

    // -------------------------------------------------------------------------
    // 推荐人领取
    // -------------------------------------------------------------------------

    /// @notice 领取累计的推荐奖励（代币已在本合约托管）
    function claimReferralReward() external nonReentrant {
        require(_tokenSet, "token not set");

        uint256 amount = pendingReward[msg.sender];
        require(amount > 0, "nothing to claim");

        // Checks-Effects-Interactions：先清零再转账，防重入多领
        pendingReward[msg.sender] = 0;
        astraToken.safeTransfer(msg.sender, amount);

        emit ReferralRewardClaimed(msg.sender, amount);
    }

    // -------------------------------------------------------------------------
    // 只读查询（前端 / 测试用）
    // -------------------------------------------------------------------------

    function pendingReferralReward(
        address referrer
    ) external view returns (uint256) {
        return pendingReward[referrer];
    }
}
