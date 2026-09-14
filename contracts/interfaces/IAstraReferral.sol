// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title IAstraReferral
 * @notice Staking 合约只依赖本接口；推荐领取等扩展函数在 AstraReferral 实现里。
 *
 * 调用时机：用户首次 stake 且传入非零 referrer 时，由 AstraStaking 调用。
 * 返回值：应划入推荐合约托管的奖励数量（一般为 firstStakeAmount 的 5%）。
 */
interface IAstraReferral {
    function accrueOnFirstStake(
        address user,
        uint256 firstStakeAmount,
        address referrer
    ) external returns (uint256 reward);
}
