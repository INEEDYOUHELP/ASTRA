// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.6.0
pragma solidity ^0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAstraReferral} from "./interfaces/IAstraReferral.sol";

contract AstraStaking is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant PARAM_SETTER_ROLE = keccak256("PARAM_SETTER_ROLE");
    uint256 public constant ACC_PRECISION = 1e18;
    uint256 public constant MIN_REWARD_RESERVE = 3_000_000e18;

    IERC20 public astraToken;
    IAstraReferral public referral;
    bool private _tokenSet;

    uint256 public totalStaked;
    uint256 public rewardRatePerSec;
    uint256 public accRewardPerShare;
    uint256 public lastRewardTime;
    bool public lockTriggered;

    struct UserInfo {
        uint256 amount;
        uint256 rewardDebt;
        bool hasStakedBefore;
    }

    mapping(address => UserInfo) public users;

    event AstraTokenSet(address indexed token);
    event ReferralSet(address indexed referral);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event RewardRateUpdated(uint256 oldRate, uint256 newRate);
    event LockTriggered();

    constructor(address adminSafe) {
        require(adminSafe != address(0), "adminSafe=0");
        _grantRole(DEFAULT_ADMIN_ROLE, adminSafe);
        _grantRole(PARAM_SETTER_ROLE, adminSafe);
        lastRewardTime = block.timestamp;
    }

    function setAstraToken(address token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(!_tokenSet, "token already set");
        require(token != address(0), "token=0");
        astraToken = IERC20(token);
        _tokenSet = true;
        emit AstraTokenSet(token);
    }

    function setReferral(address referral_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        referral = IAstraReferral(referral_);
        emit ReferralSet(referral_);
    }

    function setRewardRatePerSec(uint256 newRate) external onlyRole(PARAM_SETTER_ROLE) {
        _requireTokenSet();
        updatePool();
        uint256 oldRate = rewardRatePerSec;
        rewardRatePerSec = newRate;
        emit RewardRateUpdated(oldRate, newRate);
    }

    function rewardPoolBalance() public view returns (uint256) {
        _requireTokenSet();
        uint256 balance = astraToken.balanceOf(address(this));
        if (balance < totalStaked) return 0;
        return balance - totalStaked;
    }

    function pendingReward(address user) public view returns (uint256) {
        UserInfo storage userInfo = users[user];
        if (userInfo.amount == 0) return 0;

        uint256 acc = accRewardPerShare;
        if (
            block.timestamp > lastRewardTime &&
            totalStaked > 0 &&
            !lockTriggered &&
            rewardRatePerSec > 0
        ) {
            uint256 delta = block.timestamp - lastRewardTime;
            uint256 reward = delta * rewardRatePerSec;
            acc += (reward * ACC_PRECISION) / totalStaked;
        }

        return (userInfo.amount * acc) / ACC_PRECISION - userInfo.rewardDebt;
    }

    function userStaked(address user) external view returns (uint256) {
        return users[user].amount;
    }

    function updatePool() public {
        _requireTokenSet();
        if (block.timestamp <= lastRewardTime) return;

        if (totalStaked > 0 && !lockTriggered && rewardRatePerSec > 0) {
            uint256 delta = block.timestamp - lastRewardTime;
            uint256 reward = delta * rewardRatePerSec;
            accRewardPerShare += (reward * ACC_PRECISION) / totalStaked;
        }

        lastRewardTime = block.timestamp;
        _checkLock();
    }

    function stake(uint256 amount, address referrer) external nonReentrant {
        require(amount > 0, "amount=0");
        _requireTokenSet();
        updatePool();

        UserInfo storage userInfo = users[msg.sender];

        if (userInfo.amount > 0) {
            uint256 pending = (userInfo.amount * accRewardPerShare) / ACC_PRECISION - userInfo.rewardDebt;
            if (pending > 0) {
                astraToken.safeTransfer(msg.sender, pending);
                emit RewardClaimed(msg.sender, pending);
            }
        }

        astraToken.safeTransferFrom(msg.sender, address(this), amount);
        userInfo.amount += amount;
        totalStaked += amount;

        if (!userInfo.hasStakedBefore) {
            userInfo.hasStakedBefore = true;
            if (referrer != address(0) && address(referral) != address(0)) {
                referral.accrueOnFirstStake(msg.sender, amount, referrer);
            }
        }

        userInfo.rewardDebt = (userInfo.amount * accRewardPerShare) / ACC_PRECISION;
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external nonReentrant {
        require(amount > 0, "amount=0");
        _requireTokenSet();
        updatePool();

        UserInfo storage userInfo = users[msg.sender];
        require(userInfo.amount >= amount, "insufficient staked");

        uint256 pending = (userInfo.amount * accRewardPerShare) / ACC_PRECISION - userInfo.rewardDebt;
        if (pending > 0) {
            astraToken.safeTransfer(msg.sender, pending);
            emit RewardClaimed(msg.sender, pending);
        }

        userInfo.amount -= amount;
        totalStaked -= amount;
        userInfo.rewardDebt = (userInfo.amount * accRewardPerShare) / ACC_PRECISION;

        astraToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function claimReward() public nonReentrant {
        _requireTokenSet();
        updatePool();

        UserInfo storage userInfo = users[msg.sender];
        uint256 pending = (userInfo.amount * accRewardPerShare) / ACC_PRECISION - userInfo.rewardDebt;
        require(pending > 0, "nothing to claim");

        userInfo.rewardDebt = (userInfo.amount * accRewardPerShare) / ACC_PRECISION;
        astraToken.safeTransfer(msg.sender, pending);
        emit RewardClaimed(msg.sender, pending);
    }

    function claim() external {
        claimReward();
    }

    function _checkLock() internal {
        if (!lockTriggered && rewardPoolBalance() < MIN_REWARD_RESERVE) {
            lockTriggered = true;
            emit LockTriggered();
        }
    }

    function _requireTokenSet() internal view {
        require(_tokenSet, "token not set");
    }
}