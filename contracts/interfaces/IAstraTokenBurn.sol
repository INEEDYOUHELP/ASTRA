// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title IAstraTokenBurn
 * @notice BurnController 只需「烧自己余额」能力；完整 ERC20 由 IERC20 另引。
 */
interface IAstraTokenBurn {
    function burn(uint256 amount) external;
}
