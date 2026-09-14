// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title IAstraStakingBurnSource
 * @notice BurnController 从社区奖励池拉取代币销毁时使用的最小接口。
 * @dev 只允许划转「奖励池」部分，不得动用户质押本金。
 */
interface IAstraStakingBurnSource {
    function rewardPoolBalance() external view returns (uint256);

    function transferForBurn(uint256 amount) external;
}
