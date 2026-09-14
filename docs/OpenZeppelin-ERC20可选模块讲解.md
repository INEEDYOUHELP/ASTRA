# OpenZeppelin ERC20 可选模块讲解（Astra 项目版）

> 目的：对照 OpenZeppelin 官网（Contracts + Wizard）解释 ERC20 的可选项，尤其是 `Votes`、`Cross-Chain Bridging`、`Access Control`、`Upgradeability` 与 `Info`（`Security Contact`、`License`），并给出 Astra 的明确选型。

---

## 1. 对照官网：ERC20 页面常见分组

在 Wizard 里，ERC20 配置可以理解为以下几组：

1. **Token 基础信息**：name、symbol、premint
2. **ERC20 扩展能力**：mintable、burnable、pausable、permit、votes、flash mint、capped
3. **权限模型**：none / ownable / roles(access control)
4. **跨链能力**：cross-chain bridging（依赖桥接抽象）
5. **升级能力**：non-upgradeable / UUPS / transparent（不同版本 UI 命名略有差异）
6. **Info 元数据**：security contact、license

> 不同 OZ 版本 UI 细节会微调，但核心概念一致。

---

## 1.1 大白话速读（先看这个）

如果你只想快速懂，按下面理解就行：

- `ERC20`：就是“能转账的代币基础功能”。
- `Mintable`：允许后续继续“增发新币”（要配权限，不然风险很大）。
- `Burnable`：允许“把币销毁掉”，总量会变少。
- `Permit`：不用先点一次 `approve`，可以签名直接授权，省一步交易。
- `Votes`：把代币变成“投票权系统”，会多记录历史投票快照，功能更强但更复杂。
- `AccessControl`：把权限分成多个岗位（管理员、销毁员、keeper），比单老板（`Ownable`）安全。
- `Cross-chain`：不是自动跨链桥，只是给你跨链权限框架，真正跨链还要接桥协议。
- `Upgradeability`：合约可升级；好处是能修 bug，坏处是架构和风险都更复杂。
- `Security Contact`：告诉别人发现漏洞该联系谁。
- `License`：声明代码开源规则（`MIT` 最常见）。

一句话版本：

- **首版先做简单稳的**：`ERC20 + AccessControl + 受控 Burn`。  
- **二期再做复杂项**：`Votes / Cross-chain / Upgradeability`。

---

## 2. ERC20 扩展模块（官网常见选项）

## 2.1 `Mintable`（通常是 `_mint` + 权限控制）

**是什么**  
让代币在部署后还能继续增发（mint）。

**官网里怎么理解**  
OZ 的核心 `ERC20` 自带内部 `_mint`，但不会自动开放“任何人都能 mint”。  
你一般要自己写一个外部函数（如 `mint(address to, uint256 amount)`），再配上 `onlyRole(MINTER_ROLE)` 或 `onlyOwner`。

**什么时候用**  
- 稳定币、积分币、分阶段发放奖励等，需要持续发币的项目。

**风险（非常关键）**  
- 如果权限配错，会出现“无限增发”风险，经济模型直接失效。

**Astra 建议**  
- 你题目要求是固定总量 10 亿并一次性分配，**首版不应开启 mintable 外部入口**。  
- 也就是：可以保留内部 `_mint` 仅用于构造函数初始化，但不暴露后续增发接口。

## 2.2 `Burnable`（`ERC20Burnable`）

**是什么**  
给代币增加 `burn` / `burnFrom`。

**官网里怎么理解**  
这是 ERC20 的销毁扩展，常见有两种销毁路径：
- `burn(amount)`：调用者销毁自己的余额；
- `burnFrom(account, amount)`：调用者使用已有 allowance 代替 `account` 销毁。

**怎么工作（大白话）**  
就是“把一部分代币从账本里抹掉”，总供应量会同步减少。

**什么时候用**  
有回购销毁、动态平衡、通缩机制。

**风险（非常关键）**
- 如果把销毁权限设计错，可能导致不该销毁的人也能操作；
- 如果你依赖 `burnFrom`，要注意 allowance 管理和授权边界；
- 业务上要明确“烧的是谁的余额”：用户余额、奖励池余额，还是控制器先持有后再烧。

**Astra 建议**  
建议保留“受控 burn”，但不要开放给任意地址。  
最佳实践是 `ERC20 + AccessControl + onlyRole(BURNER_ROLE)`。

**实现建议（Astra）**
- 推荐让 `AstraBurnController` 拿 `BURNER_ROLE`；
- `AstraToken` 暴露受控 `burn` 入口；
- 通过事件记录每次销毁（amount、epoch、caller）。

## 2.3 `Capped`（`ERC20Capped`）

**是什么**  
后续 mint 受 cap 限制。

**官网里怎么理解**  
`ERC20Capped` 是对“增发上限”的硬约束：即使有 mint 权限，也不能超过 cap。

**怎么工作（大白话）**  
像给代币总量装了“天花板”。可以继续发币，但永远不能突破这个顶。

**什么时候用**  
项目未来可能继续 mint，但希望总量不可超上限。

**风险**
- 容易和“固定总量”目标冲突（你本来就不想再 mint，就没必要加复杂度）；
- 若业务理解不一致，可能出现“以为不能增发，实际上还可以（只要没到 cap）”的误解。

**Astra 建议**  
你是一次性固定总量，首版可不选。

## 2.4 `Pausable`（`ERC20Pausable`）

**是什么**  
可暂停转账/某些敏感路径。

**官网里怎么理解**  
给合约加 `pause/unpause` 开关，通常会影响转账相关逻辑。

**怎么工作（大白话）**  
像“紧急刹车”。出问题时先停，防止继续扩散。

**什么时候用**  
需要应急开关。

**风险**
- 暂停策略设计不好会伤害用户（例如把用户赎回也停了）；
- 权限集中在单地址会有治理风险；
- 暂停后恢复流程如果没定义清楚，运维会混乱。

**Astra 建议**  
可选。若启用，必须提前定义“暂停后是否允许用户赎回/领取”。

**实现建议（Astra）**
- 由 `PAUSER_ROLE` 控制 `pause/unpause`；
- 强建议保留“用户可安全退出”的路径（例如允许 unstake/release）。

## 2.5 `Permit`（`ERC20Permit`, EIP-2612）

**是什么**  
签名授权替代链上 `approve`。

**官网里怎么理解**  
用户离线签名，链上由他人提交签名完成授权（`permit`），减少一次主动发交易。

**怎么工作（大白话）**  
原来要两步：`approve` 再 `stake`。  
用了 permit 后可以接近一步完成（前端体验更好）。

**什么时候用**  
前端交互频繁，希望减少一次交易。

**风险**
- 签名参数处理不当会有重放/失效问题（需正确校验 nonce、deadline、domain）；
- 前端和钱包兼容性要测试，不是所有钱包 UX 一样。

**Astra 建议**  
首版可不加，后续优化体验再加。

**实现建议（Astra）**
- 首版先保证核心经济逻辑正确；
- 二期再做 `permit + stake` 的组合交互优化。

## 2.6 `Votes`（`ERC20Votes`）

**是什么**  
引入治理投票能力（带历史快照 checkpoints）。

**关键机制（官网/源码语义）**
- 需要 `delegate()` 才会把“余额”变成“可计票投票权”；
- 支持 `delegateBySig()`；
- 支持 `getPastVotes()`/`getVotes()` 这种历史查询；
- 因为要维护 checkpoints，转账和 mint 的 gas 与复杂度会上升。

**什么时候用**
- 要做 Governor/DAO 投票；
- 明确需要历史投票快照。

**风险**
- 会显著增加系统复杂度（委托、快照、治理参数）；
- 开发与测试成本上升（需要覆盖投票权变化、历史查询、边界块高）；
- 与“只做经济模型”的首版目标可能不匹配。

**Astra 建议**
- 题目没强制治理投票，首版不建议开启。
- 若后续做治理模块，再单独引入更稳。

**实现建议（Astra）**
- 如果后续真的要上 Votes，建议独立里程碑：
  1. 先把 `delegate` 流程和前端提示做完整；
  2. 再接 Governor；
  3. 最后做完整治理测试。

## 2.7 `Flash Mint`（`ERC20FlashMint`）

**是什么**  
支持同一交易内借出并归还。

**官网里怎么理解**  
这是类似“闪电贷”的代币能力：一笔交易内借出，交易结束前必须归还，否则整笔回滚。

**怎么工作（大白话）**  
给高级策略玩家的“临时借币功能”，用完立即还，不留欠账。

**什么时候用**  
高级 DeFi 组合场景。

**风险**
- 复杂组合容易引入新攻击面；
- 对你当前业务（质押/归属/推荐/销毁）几乎没直接收益；
- 审计成本明显上升。

**Astra 建议**  
不需要，首版不选。

---

## 3. Access Control（官网细分）

## 3.1 `Ownable`

**特点**  
单管理员，简单。

**风险**  
权限过于集中，不符合你题目“禁止单点管理员”的目标。

## 3.2 `AccessControl`（Roles）

**特点**  
多角色、细粒度权限，适合多签治理。

**Astra 推荐角色示例**
- `DEFAULT_ADMIN_ROLE`（授予 `AdminSafe`）
- `BURNER_ROLE`（授予 `AstraBurnController`）
- `KEEPER_ROLE`（授予链下 keeper）
- `PARAM_SETTER_ROLE`（参数调整）
- `TREASURY_ROLE`（资金操作）

**结论**  
Astra 首版应选 `AccessControl`，不建议只用 `Ownable`。

---

## 4. Cross-Chain Bridging（官网概念补全）

> 这块在 OZ 文档里主要是跨链抽象与跨链权限模型，不等于“自动帮你完成桥接业务”。

## 4.1 基础抽象：`CrossChainEnabled`

用于识别当前调用是否来自跨链消息、跨链发送方是谁。

常见能力：
- `onlyCrossChain`
- `onlyCrossChainSender(expected)`
- `_isCrossChain()`
- `_crossChainSender()`

## 4.2 跨链权限：`AccessControlCrossChain`（v4.x 文档常见）

核心思想：**本链角色** 与 **跨链别名角色** 分离。  
例如跨链调用时检查的是 `_crossChainRoleAlias(ROLE)`，避免“不同链同地址”造成权限混淆。

## 4.3 你要知道的现实限制

1. OZ 提供的是抽象和部分桥接适配，不是一键跨链业务系统；
2. 你仍需要选定桥基础设施（如特定 L1/L2 bridge、消息协议）；
3. 跨链 token 还要考虑“锁铸/销铸模型、供应一致性、故障回滚”。

## 4.4 Astra 建议

- 首版先不做跨链桥接；
- 先把单链经济模型跑通（Token/Vesting/Staking/Referral/Burn）；
- 二期再单独设计跨链。

---

## 5. Upgradeability（官网对照）

## 5.1 非升级（Non-upgradeable）

**优点**：简单、风险低、可审计性强。  
**缺点**：逻辑有 bug 时只能迁移新合约。

## 5.2 UUPS（`UUPSUpgradeable`）

**特点**
- 升级逻辑在实现合约里；
- 需要重写 `_authorizeUpgrade()` 做权限控制；
- 一般更轻量，部署成本更友好。

**风险点**
- 权限控制写错会导致严重问题（可被任意升级或永远锁死）。

## 5.3 Transparent Proxy

**特点**
- 管理逻辑在代理/ProxyAdmin 侧；
- 管理员与普通用户调用路径更分离；
- 成本通常更高，体系更“重”。

## 5.4 Astra 建议

- 首版建议**不升级**（先把业务和测试跑稳）；
- 若确实要升级，优先 UUPS，但必须：
  1. 全量 initializer 设计；
  2. storage layout 策略；
  3. 升级测试（旧状态到新实现）。

---

## 6. Info 区域（Security Contact / License）详解

这两个字段会出现在生成代码头部注释里，便于审计和披露。

## 6.1 Security Contact

**作用**  
告诉白帽或审计方，发现漏洞该联系谁。

**常见格式**
- 邮箱：`security@yourdomain.com`
- 安全页面：`https://yourdomain.com/security`
- 漏洞提交通道：`https://github.com/<org>/<repo>/security/advisories`

**你的示例**
- `security@example.com` 语法上可用，但建议换成真实通道。

## 6.2 License（SPDX）

**作用**  
生成 `// SPDX-License-Identifier: ...`，明确开源许可。

**常见可选值**
- `MIT`（最常见、宽松）
- `Apache-2.0`
- `GPL-3.0`
- `UNLICENSED`（不开放）

**Astra 建议**
- 如果你准备开源并上传 GitHub，`MIT` 合适。

## 6.3 安全注意

`info.securityContact` / `info.license` 这类字段在自动化场景里应避免接收未经清洗的外部文本。  
你手动在 Wizard 填写通常没问题，但在脚本化生成场景建议固定白名单值。

---

## 7. Astra 对照官网的最终勾选建议

## 7.1 首版（推荐）

- [x] ERC20 基础
- [x] Premint（构造函数固定总量）
- [ ] Mintable（首版不开放外部增发）
- [x] Access Control（roles）
- [x] Burn（受控）
- [ ] Permit
- [ ] Votes
- [ ] Cross-chain
- [ ] Upgradeability
- [x] Info：Security Contact（真实安全邮箱）
- [x] Info：License = `MIT`

## 7.2 二期（按需）

- [ ] Permit（前端交互优化）
- [ ] Mintable（仅在你后续要动态发币时再开启，并严格限权）
- [ ] Votes（治理需求明确后）
- [ ] Upgradeability（治理与审计资源到位后）
- [ ] Cross-chain（单链模型成熟后）

---

## 8. 一句话结论

对 Astra 目前阶段：**选 `ERC20 + AccessControl + 受控 Burn + MIT + 真实 Security Contact`，并且不开放 `Mintable`，把 `Votes / Cross-Chain / Upgradeability` 放到二期最稳。**

---

## 9. 术语对照表（英文 -> 大白话）

| 官网词汇 | 大白话解释 |
|---------|-----------|
| `premint` | 部署时先发一批初始代币 |
| `mintable` | 部署后还能继续发新币（必须严格管权限） |
| `cap` | 总量上限，不能超过这个数 |
| `delegate` | 把你的投票权委托给某地址（可委托给自己） |
| `checkpoint` | 某个历史时刻的投票权快照 |
| `Proxy` | 代理壳合约，用户打到壳，壳再转给实现逻辑 |
| `Implementation` | 真正业务代码合约 |
| `UUPS` | 升级逻辑写在实现合约里，轻量但要谨慎 |
| `Transparent` | 升级管理在代理侧，结构更重但边界更清晰 |
| `Role` | 某种权限岗位（如 `BURNER_ROLE`） |
| `onlyRole(...)` | 只有拿到这个角色的地址才能调用 |

