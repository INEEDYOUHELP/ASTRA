// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.6.0
pragma solidity ^0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @custom:security-contact 1323538680@qq.com
contract AstraToken is ERC20, ERC20Permit, AccessControl {

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;

    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    constructor(
        address adminSafe,
        address ecosystemFund,
        address communityRewardPool,
        address vestingContract,
        address liquidityReserve
    ) ERC20("AstraToken", "ASTRA") ERC20Permit("AstraToken") {
        require(adminSafe != address(0), "adminSafe=0");
        require(ecosystemFund != address(0), "ecosystemFund=0");
        require(communityRewardPool != address(0), "communityRewardPool=0");
        require(vestingContract != address(0), "vestingContract=0");
        require(liquidityReserve != address(0), "liquidityReserve=0");
        
        _grantRole(DEFAULT_ADMIN_ROLE, adminSafe);

        // 40% ecosystem fund
        _mint(ecosystemFund, 400_000_000e18);
        // 30% community reward pool (staking)
        _mint(communityRewardPool, 300_000_000e18);
        // 25% vesting (team + investor)
        _mint(vestingContract, 150_000_000e18);  // team
        _mint(vestingContract, 100_000_000e18);  // investor
        // 5% liquidity reserve
        _mint(liquidityReserve, 50_000_000e18);

        require(totalSupply() == TOTAL_SUPPLY, "bad total supply");
    }
    
    function burn(uint256 amount) external onlyRole(BURNER_ROLE) {
        _burn(_msgSender(), amount);
    }                   
}