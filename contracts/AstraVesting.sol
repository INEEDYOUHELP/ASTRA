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

/// @custom:security-contact 1323538680@qq.com

contract AstraVesting is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20; //绑定IERC20合约，方便使用SafeERC20合约中的方法

    

    IERC20 public astraToken;
    //ASTRA代币是否已设置
    bool private _tokenSet;

    struct VestingSchedule {
        uint256 totalAmount; //锁定总量
        uint256 start; //归属起始时间
        uint256 cliff; //锁定期
        uint256 duration; //线性释放时长
        uint256 released; //已领取数量
        bool exists; //是否存在
    }
    //受益人地址 → 其归属计划
    mapping(address beneficiary => VestingSchedule schedule) private _schedules;

    event AstraTokenSet(address indexed token);
    event ScheduleCreated(
        address indexed beneficiary,
        uint256 totalAmount,
        uint256 start,
        uint256 cliff,
        uint256 duration
    );
    //受益人领取归属
    event Released(address indexed beneficiary, uint256 amount);

    //多签管理员 —— 获得默认管理员角色和调度员角色
    constructor(address adminSafe) {
        require(adminSafe != address(0), "adminSafe=0");
        //AccessControl 内部函数，用来“发角色”给某个地址
        _grantRole(DEFAULT_ADMIN_ROLE, adminSafe);
    }

    //设置ASTRA代币地址
    function setAstraToken(address token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(!_tokenSet, "token already set");
        require(token != address(0), "token=0");
        astraToken = IERC20(token);
        _tokenSet = true;
        emit AstraTokenSet(token);
    }

    //创建归属计划
    function createSchedule(
        address beneficiary,
        uint256 totalAmount,
        uint256 start,
        uint256 cliff,
        uint256 duration
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_tokenSet, "token not set"); //检查ASTRA代币是否已设置
        require(beneficiary != address(0), "beneficiary=0");
        require(totalAmount > 0, "amount=0");
        require(duration > 0, "duration=0");
        require(!_schedules[beneficiary].exists, "schedule exists");

        //添加到归属计划映射中
        _schedules[beneficiary] = VestingSchedule({
            totalAmount: totalAmount,
            start: start,
            cliff: cliff,
            duration: duration,
            released: 0,
            exists: true
        });

        emit ScheduleCreated(beneficiary, totalAmount, start, cliff, duration);
    }

    //计算受益人当前可释放的数量(可领取 = 已归属(now) − 已领取)
    function releasable(address beneficiary) public view returns (uint256) {
        //memory：临时变量，不会被永久存储在合约中，只在函数执行期间存在
        VestingSchedule memory schedule = _schedules[beneficiary];
        //检查归属计划是否存在
        if (!schedule.exists) return 0;
        uint256 now = block.timestamp;

        uint256 vested = _vestedAmount(schedule, now);
        return vested - schedule.released;
    }

    //计算受益人当前可领取的总归属数量
    function _vestedAmount(
        VestingSchedule memory schedule,
        uint256 timestamp
    ) internal pure returns (uint256) {
        if (timestamp < schedule.start + schedule.cliff) {
            return 0;
        }

        uint256 vestingEnd = schedule.start +
            schedule.cliff +
            schedule.duration;
        if (timestamp >= vestingEnd) {
            return schedule.totalAmount;
        }

        return
            (schedule.totalAmount *
                (timestamp - schedule.start - schedule.cliff)) /
            schedule.duration;
    }

    //受益人领取归属
    //nonReentrant：防止重入攻击
    function release() external nonReentrant {
        //获取受益人地址和可领取数量
        address beneficiary = msg.sender;
        uint256 amount = releasable(beneficiary);
        //进行领取操作
        require(amount > 0, "nothing to release");
        //更新已领取数量
        _schedules[beneficiary].released += amount;
        //转账
        astraToken.safeTransfer(beneficiary, amount);

        emit Released(beneficiary, amount);
    }

    //获取受益人归属计划
    function getSchedule(
        address beneficiary
    ) external view returns (VestingSchedule memory) {
        return _schedules[beneficiary];
    }
}
