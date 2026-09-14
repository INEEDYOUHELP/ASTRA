# Astra 合约架构与 OpenZeppelin 组合指南

> 目标：给出一份可以直接指导编码和测试的合约设计文档，重点回答
> 1) 合约怎么拆；2) 各合约怎么协作；3) OpenZeppelin 应该用什么组合。

---

## 1. 设计原则（先定边界再写代码）

1. **单一职责**：每个合约只管一个业务核心，避免“大一统合约”难维护。
2. **资金安全优先**：所有资金流函数先改状态再转账（CEI）。
3. **角色最小权限**：用 `AccessControl` 拆分角色，不用单 `owner` 覆盖所有敏感操作。
4. **先规格后实现**：先固定状态变量 / 事件 / 函数，再写合约和测试。
5. **可测试性**：关键参数（奖励速率、阈值、epoch）可配置且有上限约束。

---

## 2. 推荐合约拆分

### 2.1 必选合约（核心）

1. `AstraToken`
2. `AstraVesting`
3. `AstraStaking`
4. `AstraReferral`
5. `AstraBurnController`

### 2.2 可选合约（治理增强）

6. `AstraTreasury`（建议：托管生态基金/流动性操作）

---

## 3. 合约职责与边界

## 3.1 `AstraToken`

**职责**
- 固定总量 ASTRA（10 亿，18 decimals）。
- 部署时一次性分配到基金、奖励池、归属池、流动性地址。
- 提供受控销毁入口（可选）。

**不做什么**
- 不提供公开 `mint`。
- 不承担 staking/vesting/referral 业务逻辑。

## 3.2 `AstraVesting`

**职责**
- 管理多受益人归属计划（team/investor）。
- 计算可释放额度并发放代币。

**不做什么**
- 不负责质押奖励。
- 不负责推荐关系。

## 3.3 `AstraStaking`

**职责**
- 用户 `stake/unstake/claim`。
- 用 `accRewardPerShare` 累计奖励，避免 O(n)。
- 监控奖励池安全阈值（低于 1% 触发锁定）。
- 与 `AstraReferral` 协作处理首次质押推荐奖励。

**不做什么**
- 不直接处理复杂预言机逻辑（交给 burn 控制器）。

## 3.4 `AstraReferral`

**职责**
- 仅处理“首质押绑定推荐人”和“5% 推荐奖励记账/领取”。
- 限制只有 staking 合约能调用首次质押钩子。

## 3.5 `AstraBurnController`

**职责**
- 接收 keeper 提交的周期指标。
- 判断是否满足销毁条件。
- 调用 token 的 burn 接口执行受控销毁。

## 3.6 `AstraTreasury`（可选）

**职责**
- 托管生态基金与流动性拨备。
- 统一对外资金动作（转账、加池）。

---

## 4. OpenZeppelin 组合建议（重点）

## 4.1 总结：该用什么

| 合约 | 推荐 OZ 组合 | 理由 |
|------|--------------|------|
| `AstraToken` | `ERC20` + `AccessControl` | 标准代币 + 角色治理 |
| `AstraVesting` | `AccessControl` + `ReentrancyGuard` + `SafeERC20` | 管理计划 + 防重入 + 安全转账 |
| `AstraStaking` | `AccessControl` + `ReentrancyGuard` + `SafeERC20` | 高资金频操作，需强安全 |
| `AstraReferral` | `AccessControl` + `SafeERC20`（若自持资金） | 限制调用源 + 安全发奖 |
| `AstraBurnController` | `AccessControl` | keeper/参数管理角色控制 |
| `AstraTreasury` | `AccessControl` + `SafeERC20` + `ReentrancyGuard` | 金库资金操作防护 |

## 4.2 `ERC20` 还是 `ERC20Burnable`？

**推荐方案：`ERC20` + 自定义 `burn(uint256)` + `onlyRole(BURNER_ROLE)`**

原因：
- 你需要“谁能销毁”可控（仅 burn 控制器或特定角色）。
- 直接继承 `ERC20Burnable` 也能做，但通常还要再包一层权限，避免任意持币人随意 burn 的业务歧义。

## 4.3 `Ownable` 是否可用？

可以用，但**本项目不推荐作为主权限模型**。  
题目明确不希望单点管理员，优先：
- `AccessControl` + 多签地址（Safe）。

## 4.4 `VestingWallet` 是否直接复用？

不建议直接用作主实现。  
`VestingWallet` 更偏单受益人模型，而你需要多受益人 + 两套释放规则（团队/投资者），建议自定义 `Schedule` 结构实现。

## 4.5 `Pausable` 要不要加？

可选。  
如果你希望演示“紧急开关”，可在 staking/treasury 增加 `Pausable`，但要明确定义暂停后哪些路径仍允许（例如 `unstake` 是否放行）。

---

## 5. 建议的接口与调用关系

## 5.1 接口最小集

```solidity
interface IAstraReferral {
    function accrueOnFirstStake(address user, uint256 amount, address referrer) external returns (uint256);
}

interface IAstraTokenBurnable {
    function burn(uint256 amount) external;
}
```

## 5.2 调用链

1. 用户 `approve` ASTRA 给 `AstraStaking`
2. 用户调用 `AstraStaking.stake(amount, referrer)`
3. 若首次质押，`AstraStaking -> AstraReferral.accrueOnFirstStake(...)`
4. keeper 周期调用 `AstraBurnController.checkAndBurn(...)`
5. `AstraBurnController -> AstraToken.burn(...)`

---

## 6. 关键状态与函数清单（落地导向）

## 6.1 `AstraToken`

**状态**
- `TOTAL_SUPPLY = 1_000_000_000e18`
- `BURNER_ROLE`

**函数**
- `constructor(adminSafe, ecosystemFund, staking, vesting, liquidityReserve)`
- `burn(uint256 amount)`（仅 `BURNER_ROLE`）

## 6.2 `AstraVesting`

**状态**
- `struct Schedule { beneficiary, totalAmount, start, cliffDuration, vestingDuration, released }`
- `mapping(bytes32 => Schedule) schedules`

**函数**
- `createSchedule(...)`
- `vestedAmount(scheduleId, timestamp)`
- `releasable(scheduleId)`
- `release(scheduleId)`

## 6.3 `AstraStaking`

**状态**
- `totalStaked`
- `rewardRatePerSec`
- `accRewardPerShare`
- `lastRewardTime`
- `MIN_REWARD_RESERVE = 3_000_000e18`
- `lockTriggered`
- `mapping(address => UserInfo) users`

**函数**
- `stake(uint256 amount, address referrer)`
- `unstake(uint256 amount)`
- `claimReward()`
- `pendingReward(address user)`
- `setRewardRatePerSec(uint256 newRate)`（仅角色）

## 6.4 `AstraReferral`

**状态**
- `REFERRAL_BPS = 500`
- `referrerOf[user]`
- `pendingReferralRewards[referrer]`
- `staking`（唯一授权调用源）

**函数**
- `setStaking(address staking_)`
- `accrueOnFirstStake(user, amount, referrer)`（仅 staking）
- `claimReferralReward()`

## 6.5 `AstraBurnController`

**状态**
- `epochDuration`
- `burnBps`
- `maxBurnPerEpoch`
- `minLiquidityAddedETH`
- `maxPriceDeviationBps`
- `mapping(epoch => burned)`

**函数**
- `currentEpoch()`
- `shouldBurn(...)`
- `checkAndBurn(...)`（仅 `KEEPER_ROLE`）
- `setBurnParams(...)`（仅参数角色）

---

## 7. 目录与开发顺序建议

## 7.1 目录

```text
contracts/
  AstraToken.sol
  AstraVesting.sol
  AstraStaking.sol
  AstraReferral.sol
  AstraBurnController.sol
  AstraTreasury.sol         (optional)
  interfaces/
    IAstraReferral.sol
    IAstraTokenBurnable.sol
```

## 7.2 开发顺序（建议）

1. `AstraToken`（先把资产和权限根基打稳）
2. `AstraVesting`（独立逻辑，便于验证释放曲线）
3. `AstraStaking`（核心复杂度最高）
4. `AstraReferral`（对接 staking 首质押钩子）
5. `AstraBurnController`（与 keeper/参数联动）
6. `AstraTreasury`（可选增强）

---

## 8. 你现在可以直接执行的实现策略

1. 先按本文件创建 5 个空合约与 2 个接口文件。
2. 每个合约先只写：
   - 状态变量
   - 事件
   - 函数签名
   - 访问控制修饰器
3. 再逐个补逻辑和单测，避免一次写完难定位 bug。
4. 每完成一个合约就写对应单测，不要全部写完再补测试。

---

## 9. 一句话回答你的核心问题

- **代币合约用 `ERC20` + `AccessControl`，并加受控 `burn` 是最稳妥方案。**
- **高资金流合约（staking/vesting/treasury）组合 `ReentrancyGuard` + `SafeERC20`。**
- **权限治理用 `AccessControl` + 多签，不建议单 `Ownable`。**

