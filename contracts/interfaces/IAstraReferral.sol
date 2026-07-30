// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IAstraReferral {
    function accrueOnFirstStake(
        address user,
        uint256 firstStakeAmount,
        address referrer
    ) external returns (uint256 reward);
}
