# Astra

去中心化内容创作与策展平台的代币经济模型全栈实现。创作者在平台发布内容，用户（策展人）通过质押原生代币 **ASTRA** 支持创作者，并从策展行为中获得链上奖励。

本仓库按「先安全基础、再核心经济、后集成演示」的顺序推进，目标是在以太坊生态测试网上交付可验证、可演示的完整系统。

---

## 1. 项目目标

设计并实现 Astra 经济模型的核心智能合约，并完成与链下服务、前端应用、DEX 流动性的集成。系统需满足：

- 固定总量 ERC20 代币与一次性初始分配
- 团队 / 投资者多受益人归属释放
- 质押奖励、推荐分佣与奖励池安全阈值锁定
- Uniswap 初始流动性注入
- 预言机驱动的动态代币销毁平衡机制
- 基于角色的多签治理（禁止单一中心化管理员）

---

## 2. 总体架构

```text
┌─────────────────────────────────────────────────────────┐
│                      应用层                              │
│   前端 dApp（质押/领取/归属/推荐）  +  运维部署脚本        │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────┐
│                    链下服务层                              │
│   Keeper/Job  ·  OracleAdapter（mock）  ·  Indexer（可选） │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────┐
│                    链上合约层                              │
│  Token · Vesting · Staking · Referral · BurnController   │
│                    （+ Treasury 可选）                     │
└─────────────────────────────────────────────────────────┘
```

### 2.1 链上合约

| 合约 | 职责 |
|------|------|
| `AstraToken` | ERC20 固定总量，部署时一次性分配至各目标地址 |
| `AstraVesting` | 多受益人线性归属，支持 cliff 与随时提取已释放额度 |
| `AstraStaking` | 质押 / 赎回 / 奖励累计与领取，监控奖励池阈值 |
| `AstraReferral` | 首质押推荐绑定，登记 5% 一次性推荐奖励 |
| `AstraBurnController` | Keeper 触发，按规则执行受控代币销毁 |
| `AstraTreasury`（可选） | 生态基金与流动性储备的代理金库 |

### 2.2 链下服务

- **Keeper / Job**：定时拉取链下指标与 Uniswap LP 状态，调用 `checkAndBurn()`
- **OracleAdapter**：将链下订单数据映射为链上可验证参数（初期可用 mock）
- **Indexer**（可选）：监听事件，为前端提供链上状态索引

### 2.3 应用层

- **前端 dApp**：钱包连接、质押、奖励领取、归属提取、推荐绑定、协议状态展示
- **运维脚本**：部署、角色配置、归属计划初始化、Uniswap 加池、验收脚本

---

## 3. 代币经济模型

### 3.1 基本规格

| 项目 | 值 |
|------|-----|
| 名称 | Astra Token |
| 符号 | ASTRA |
| 标准 | ERC20（18 decimals） |
| 总供应量 | 1,000,000,000（10 亿），部署后恒定 |

### 3.2 初始分配

| 对象 | 占比 | 数量 | 接收方 |
|------|------|------|--------|
| 生态系统基金 | 40% | 400,000,000 | 多签钱包 `EcoFundSafe` |
| 社区奖励池 | 30% | 300,000,000 | `AstraStaking` |
| 团队筹备 | 15% | 150,000,000 | `AstraVesting` |
| 投资者奖励 | 10% | 100,000,000 | `AstraVesting` |
| 流动性拨备 | 5% | 50,000,000 | 多签或 `AstraTreasury` |

所有资金出口均通过 `AccessControl` 角色控制，**`DEFAULT_ADMIN_ROLE` 仅授予多签 `AdminSafe`，不使用单一 EOA 作为最终管理员**。

### 3.3 全局角色

| 角色 | 持有者 | 权限 |
|------|--------|------|
| `DEFAULT_ADMIN_ROLE` | `AdminSafe` | 角色授予 / 撤销 |
| `PARAM_SETTER_ROLE` | 治理多签 | 奖励速率、销毁参数等（有上限） |
| `KEEPER_ROLE` | Keeper 地址 | 周期检查与触发销毁 |
| `TREASURY_ROLE` | 资金多签 | 流动性注入与资金动作 |
| `BURNER_ROLE` | `AstraBurnController` | 执行代币销毁 |
| `PAUSER_ROLE`（可选） | 应急多签 | 紧急暂停 |

---

## 4. 核心机制设计

### 4.1 归属释放（Vesting）

支持多受益人独立计划，受益人可随时领取已释放未领取的额度。

| 受益人类型 | 总量 | Cliff | 线性释放期 | 起始时间 |
|-----------|------|-------|-----------|---------|
| 团队筹备 | 150,000,000 | 6 个月 | 24 个月 | Token 部署完成时刻 |
| 投资者奖励 | 100,000,000 | 0 | 18 个月 | 代币转入锁仓合约时刻 |

核心公式：`releasable = vested(now) - released`

### 4.2 质押与奖励（Staking）

采用 `accRewardPerShare` 模型，按质押份额比例分配每秒固定释放的奖励：

```text
reward = (block.timestamp - lastRewardTime) × rewardRatePerSec
accRewardPerShare += reward × PRECISION / totalStaked
pending = user.amount × accRewardPerShare / PRECISION - user.rewardDebt
```

用户可随时 `stake` / `unstake` / `claimReward`，领取奖励不影响本金质押状态。

**奖励池安全阈值（题目强约束）：**

- 当合约可奖励余额 **< 3,000,000 ASTRA**（社区池初始量 1%）时触发 `lockTriggered`
- 锁定后：**停止新增奖励累计**
- 仍允许：赎回本金、领取已累计奖励

### 4.3 推荐分佣（Referral）

- 用户**首次** `stake` 时可指定推荐人地址
- 推荐人获得首次质押量的 **5%**（`REFERRAL_BPS = 500`）作为一次性奖励
- 奖励从社区奖励池出账，推荐人需手动 `claimReferralReward`
- 约束：禁止自推荐；每个用户仅可绑定一次推荐人

### 4.4 动态销毁（BurnController）

Keeper 每周期（建议 7 天）提交链下 / 链上指标，满足条件时执行销毁：

**触发条件（建议实现版本）：**

- `netLiquidityAddedETH < minLiquidityAddedETH`（周期内 LP 新增 ETH 不足）
- `priceDeviationBps > maxPriceDeviationBps`（ASTRA/ETH 价格偏离过大）
- 本 epoch 尚未执行过销毁

**销毁量计算：**

```text
burnAmount = min(rewardPoolBalance × burnBps / 10000, maxBurnPerEpoch)
```

每个 epoch 最多触发一次，仅 `KEEPER_ROLE` 可调用 `checkAndBurn()`。

### 4.5 关键资金流时序

```text
部署 → 初始分配 → 角色配置
  ↓
用户 approve → stake → 累计奖励份额
  ↓
首次 stake 写入推荐关系 → 记账 5% 推荐奖励
  ↓
受益人按 vesting 计划 release()
  ↓
部署脚本从流动性储备向 Uniswap 注入 ASTRA/ETH
  ↓
Keeper 周期触发 checkAndBurn() → 动态调节供应
```

---

## 5. 部署与集成规划

### 5.1 部署脚本链路

| 脚本 | 内容 |
|------|------|
| `deploy` | 按依赖顺序部署全部合约 |
| `configureRoles` | 将各角色授予对应多签 / Keeper |
| `initVesting` | 创建团队与投资者归属计划 |
| `addLiquidity` | 调用 Uniswap Router 创建 ASTRA/ETH 初始 LP |

### 5.2 Uniswap 加池

从流动性拨备地址取出 ASTRA，配合 ETH，通过 Router 的 `addLiquidity`（或 `addLiquidityETH`）创建交易对；LP 代币发送至指定接收地址（题目要求返回 owner / 多签）。

关键参数：`amountTokenDesired`、`amountETHDesired`、滑点保护最小值、`deadline`。

### 5.3 多签钱包（Safe）

| 实例 | 用途 | 测试网门限建议 |
|------|------|---------------|
| `EcoFundSafe` | 生态基金（40%） | 2/3 |
| `LiquiditySafe` | 流动性拨备（5%） | 2/3 |
| `AdminSafe` | 协议管理角色持有方 | 2/3 |

---

## 6. 技术方案

### 6.1 智能合约

- **语言**：Solidity `^0.8.24`（当前 Hardhat 配置 `0.8.28`）
- **基础库**：[OpenZeppelin Contracts v5](https://docs.openzeppelin.com/contracts/5.x/)
  - `ERC20`、`AccessControl`、`ReentrancyGuard`、`SafeERC20`
- **安全规范**：Checks-Effects-Interactions；外部 ERC20 一律 `SafeERC20`；资金函数加 `nonReentrant`

### 6.2 开发与测试框架

| 层级 | 技术选型 |
|------|---------|
| 合约测试 | Foundry（推荐，Fuzz / 不变量测试） |
| 脚本与工具链 | Hardhat 2.x + TypeScript + Viem |
| 前端 | Next.js + TypeScript + wagmi + viem |
| 目标网络 | Base Sepolia 等以太坊生态测试网 |

### 6.3 规划目录结构

```text
Aster/
├── contracts/              # 核心 Solidity 合约
│   └── interfaces/
├── script/                 # 部署与配置脚本
├── test/                   # 单测与集成测试
│   ├── unit/
│   └── integration/
├── ignition/modules/       # Hardhat Ignition 部署模块
├── apps/web/               # 前端 dApp（规划中）
├── keeper/                 # 链下 Keeper 任务（规划中）
├── hardhat.config.ts
└── foundry.toml            # Foundry 配置（规划中）
```

---

## 7. 开发里程碑

按依赖顺序分 6 个阶段交付，每阶段须有可运行测试作为验收证据。

| 阶段 | 目标 | 验收标准 |
|------|------|---------|
| **M1** | Token + Vesting | 初始分配精确；cliff / 线性释放数学正确 |
| **M2** | Staking + 阈值锁定 | 多用户奖励按比例分配；低于 1% 触发锁定且行为符合规格 |
| **M3** | Referral + 集成测试 | 首质押 5% 奖励；禁止自推荐与重复绑定 |
| **M4** | 部署脚本 + Uniswap 加池 | 全链路部署成功；LP 创建与去向正确 |
| **M5** | Oracle mock + 动态销毁 | 条件满足触发 burn；同 epoch 不可重复 |
| **M6** | 前端最小闭环 + 演示 | 钱包交互可用；文档 / 视频 / 地址表齐全 |

### 14 天参考日程

| 天数 | 任务 |
|------|------|
| Day 1 | 环境搭建、OpenZeppelin 安装、合约 SPEC 定稿 |
| Day 2 | `AstraToken` + 测试 |
| Day 3 | `AstraVesting` + 测试 |
| Day 4–6 | `AstraStaking` + 测试（核心难点） |
| Day 7 | `AstraReferral` + 测试 |
| Day 8–9 | `AstraBurnController` + Keeper mock |
| Day 10 | 部署脚本与 Uniswap 加池联调 |
| Day 11–12 | 前端最小闭环 |
| Day 13 | 全链路集成测试与缺陷修复 |
| Day 14 | 演示文档、视频、测试环境地址表 |

---

## 8. 测试策略

### 8.1 单元测试

- Token：分配总和 = 总供应量；各比例精确；非授权不可 burn
- Vesting：cliff 前不可领；中期线性正确；终点可领满
- Staking：单用户 / 多用户错峰奖励；阈值锁定后停止增发
- Referral：仅首质押触发；5% 计算与领取正确
- BurnController：条件满足 / 不满足；epoch 防重复

### 8.2 场景与安全测试

- 多用户同时质押 / 赎回
- 重入与权限绕过
- 参数越界与重复领取
- Fuzz / 不变量：累计发放不超预算；`totalStaked` 与用户余额一致

---

## 9. 最终交付物

| 交付项 | 说明 |
|--------|------|
| 合约源码 | Token / Vesting / Staking / Referral / BurnController |
| 部署脚本 | 部署 + 角色配置 + Uniswap 加池 |
| 测试 | 单测 + 集成测试，覆盖题目 3.1 ~ 4.2 |
| 演示文档 | 部署流程、功能验证截图或日志 |
| 演示视频 | Remix / Hardhat / Etherscan 或前端操作流程 |
| 测试环境地址表 | 合约地址、多签地址、测试账户与角色说明 |

---

## 10. 当前进度

- [x] Hardhat + TypeScript + Viem 工程脚手架
- [ ] Foundry 工程与 OpenZeppelin 依赖
- [ ] 核心合约实现（M1 ~ M3）
- [ ] 部署脚本与测试网部署（M4）
- [ ] 动态销毁与 Keeper（M5）
- [ ] 前端 dApp 与演示材料（M6）

---

## 11. 本地开发（简要）

```bash
git clone <your-repo-url>
cd Aster
npm install
npx hardhat compile
npx hardhat test
```

环境变量（`.env`，勿提交 Git）：

```env
RPC_URL=https://...
PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...   # 可选
```

---

## 12. 安全声明

本项目用于学习与技术考核演示。在将任何合约部署至主网或存放真实资产之前，须完成充分测试与安全审计。私钥与 `.env` 切勿提交至版本库。
