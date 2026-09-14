// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.6.0
pragma solidity ^0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title MockOracleAdapter
 * @notice 链下指标的链上「假预言机」：Keeper / 运维把周期内观测值写入，BurnController 再读取。
 *
 * 真实环境里这些数来自 Indexer / Uniswap 事件；考核演示用本合约模拟即可。
 *
 * 指标含义（对照 README 4.4）：
 *   - netLiquidityAddedETH：本 epoch 内 LP 净增 ETH（wei）
 *   - priceDeviationBps：ASTRA/ETH 相对目标价的偏离（基点，100 = 1%）
 */
contract MockOracleAdapter is AccessControl {
    bytes32 public constant ORACLE_UPDATER_ROLE = keccak256("ORACLE_UPDATER_ROLE");

    uint256 public netLiquidityAddedETH;
    uint256 public priceDeviationBps;
    uint256 public updatedAt;

    event MetricsUpdated(
        uint256 netLiquidityAddedETH,
        uint256 priceDeviationBps,
        uint256 updatedAt
    );

    constructor(address adminSafe) {
        require(adminSafe != address(0), "adminSafe=0");
        _grantRole(DEFAULT_ADMIN_ROLE, adminSafe);
        _grantRole(ORACLE_UPDATER_ROLE, adminSafe);
    }

    /// @notice Keeper / 脚本在调用 checkAndBurn 前更新本周期观测值
    function setMetrics(
        uint256 netLiquidityAddedETH_,
        uint256 priceDeviationBps_
    ) external onlyRole(ORACLE_UPDATER_ROLE) {
        netLiquidityAddedETH = netLiquidityAddedETH_;
        priceDeviationBps = priceDeviationBps_;
        updatedAt = block.timestamp;
        emit MetricsUpdated(netLiquidityAddedETH_, priceDeviationBps_, updatedAt);
    }
}
