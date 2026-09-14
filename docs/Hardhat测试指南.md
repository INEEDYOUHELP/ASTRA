# Hardhat 常见测试：导入用法与标准流程

> 本文档基于本仓库技术栈：**Hardhat 2 + `@nomicfoundation/hardhat-toolbox-viem` + Chai + Viem**。  
> 示例文件：`test/Lock.ts`、`test/AstraToken.test.reference.ts`。

---

## 1. 运行测试

```bash
# 跑全部测试
npx hardhat test

# 跑单个文件
npx hardhat test test/AstraToken.test.ts

# 只跑名称匹配的用例（grep）
npx hardhat test --grep "Burn"

# 先编译再测
npx hardhat compile && npx hardhat test
```

---

## 2. 导入一览：什么必需、什么按需

### 2.1 几乎每个测试文件都有（基础三件套）

```typescript
import { expect } from "chai";
import hre from "hardhat";
```

| 导入 | 来源 | 作用 |
|------|------|------|
| `expect` | `chai`（由 hardhat-toolbox 带入） | 断言：`equal`、`rejected`、`fulfilled` 等 |
| `hre` | `hardhat` | 部署合约、拿账户、`getContractAt`、`getPublicClient` |

没有这两样，基本写不了 Hardhat 测试。

---

### 2.2 `network-helpers`（按需）

```typescript
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
```

| 导入 | 何时需要 | 常见用法 |
|------|----------|----------|
| `loadFixture` | 多个 `it` 共用同一套部署环境 | `await loadFixture(deployFixture)` |
| `time` | 测时间锁、vesting cliff、epoch 等 | `time.latest()`、`time.increase()`、`time.increaseTo()` |

**`loadFixture` 原理简述：**

- 第一次调用 fixture：真正执行部署
- 后续每个 `it`：回到快照状态，环境干净、速度快
- 适合：部署成本高、测试之间不能互相污染

**`time` 常用 API：**

```typescript
const now = await time.latest();           // 当前链上时间戳（秒）
await time.increase(3600);                 // 快进 1 小时
await time.increaseTo(unlockTimestamp);    // 快进到指定时间戳
await time.setNextBlockTimestamp(ts);      // 设置下一区块时间（配合 mine）
```

**什么时候不用 `loadFixture`：**

- 这个 `it` 需要**不同的部署参数**（例如故意传错参数测 revert）
- 只有一个简单测试

参考 `Lock.ts` 第 65–73 行：测「unlockTime 不在未来」时，故意不用 fixture，单独 `deployContract`。

---

### 2.3 `viem` 工具函数（按测试内容选）

```typescript
import { getAddress, parseEther, parseGwei, zeroAddress } from "viem";
```

| 导入 | 作用 | 典型场景 |
|------|------|----------|
| `parseEther("1.5")` | 人类可读 ETH/ERC20 数量 → wei | `balanceOf`、`totalSupply` 断言 |
| `parseGwei("1")` | gwei → wei | 测合约收发的 ETH（如 `Lock`） |
| `zeroAddress` | `0x000…000` | 测 `require(addr != address(0))` |
| `getAddress(addr)` | 地址校验和规范化 | 比较 `owner` 等地址字段 |
| `formatEther(wei)` | wei → 字符串（调试输出时用） | `console.log(formatEther(balance))` |
| `maxUint256` | 最大 uint256 | `approve` 无限授权场景 |

**注意：** Solidity 里 `1_000_000_000e18` 在测试里通常写成 `parseEther("1000000000")`，两者数值相同。

**BigInt 字面量：** 链上 `uint256` 在 JS 里是 `bigint`，比较时用 `0n`、`1n`，不要混用普通 `number` 做大额运算。

---

## 3. `hre.viem` 常用 API

### 3.1 获取测试账户

```typescript
const [admin, user1, user2] = await hre.viem.getWalletClients();
// admin.account.address  → 地址
// admin                  → 可签名交易的 wallet client
```

Hardhat 本地链默认提供多个预充值账户，按索引扮演不同角色（管理员、用户、陌生人等）。

---

### 3.2 部署合约

```typescript
// 无 constructor 参数
const token = await hre.viem.deployContract("AstraToken");

// 有 constructor 参数
const token = await hre.viem.deployContract("AstraToken", [
  admin.account.address,
  fund.account.address,
]);

// 部署时发送 ETH（payable constructor / 存 ETH）
const lock = await hre.viem.deployContract("Lock", [unlockTime], {
  value: parseGwei("1"),
});
```

- 第一个参数：合约名（对应 `contracts/` 下编译产物）
- 第二个参数：constructor 参数数组
- 第三个参数（可选）：`value` 等交易选项

---

### 3.3 读取合约状态（view / pure）

```typescript
const name = await token.read.name();
const balance = await token.read.balanceOf([user.account.address]);
const hasRole = await token.read.hasRole([roleId, user.account.address]);
```

**Viem 规则：即使只有一个参数，也要放在数组里：** `fn([arg])`。

---

### 3.4 发送交易（改状态）

```typescript
await token.write.transfer([recipient, amount]);
await token.write.burn([amount]);
```

默认由 `deployContract` 时的第一个账户签名。要用**指定账户**发交易 → 见下一节 `getContractAt`。

---

### 3.5 指定调用者（权限测试必会）

```typescript
const tokenAsAdmin = await hre.viem.getContractAt(
  "AstraToken",
  token.address,
  { client: { wallet: adminSafe } }
);

await tokenAsAdmin.write.grantRole([burnerRole, burner.account.address]);
```

| 场景 | 做法 |
|------|------|
| 管理员 `grantRole` | `getContractAt` + admin 钱包 |
| 普通用户 `transfer` | `getContractAt` + user 钱包 |
| 无权限者应 revert | `getContractAt` + stranger 钱包 |

---

### 3.6 公共客户端（查 ETH 余额、等回执、查事件）

```typescript
const publicClient = await hre.viem.getPublicClient();

// 合约 ETH 余额
const ethBalance = await publicClient.getBalance({ address: lock.address });

// 等待交易上链
const hash = await token.write.transfer([to, amount]);
await publicClient.waitForTransactionReceipt({ hash });
```

---

### 3.7 事件断言

```typescript
const hash = await lock.write.withdraw();
await publicClient.waitForTransactionReceipt({ hash });

const events = await lock.getEvents.Withdrawal();
expect(events).to.have.lengthOf(1);
expect(events[0].args.amount).to.equal(lockedAmount);
```

---

## 4. Chai `expect` 常见断言

### 4.1 相等

```typescript
expect(await token.read.name()).to.equal("AstraToken");
expect(await token.read.totalSupply()).to.equal(parseEther("1000000000"));
expect(hasRole).to.equal(true);
```

### 4.2 交易应成功

```typescript
await expect(lock.write.withdraw()).to.be.fulfilled;
```

### 4.3 交易应失败（revert）

```typescript
// 只要求 revert，不检查错误文案
await expect(stranger.write.burn([1n])).to.be.rejected;

// 要求 revert 且包含特定 reason（require 字符串 / custom error 片段）
await expect(
  hre.viem.deployContract("AstraToken", [zeroAddress, ...])
).to.be.rejectedWith("adminSafe=0");

await expect(lock.write.withdraw()).to.be.rejectedWith("You can't withdraw yet");
```

### 4.4 数组 / 长度

```typescript
expect(events).to.have.lengthOf(1);
```

---

## 5. 标准测试流程（推荐模板）

```typescript
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { parseEther, zeroAddress } from "viem";

describe("MyContract", function () {
  // ── Step 1: Fixture — 部署 + 返回测试需要的对象 ──
  async function deployFixture() {
    const [owner, user] = await hre.viem.getWalletClients();
    const contract = await hre.viem.deployContract("MyContract", [owner.account.address]);
    return { contract, owner, user };
  }

  // ── Step 2: 按功能分组 describe ──
  describe("Deployment", function () {
    it("should set initial state", async function () {
      const { contract } = await loadFixture(deployFixture);
      expect(await contract.read.someValue()).to.equal(42n);
    });

    it("should reject invalid constructor args", async function () {
      await expect(
        hre.viem.deployContract("MyContract", [zeroAddress])
      ).to.be.rejectedWith("owner=0");
    });
  });

  describe("Core logic", function () {
    it("should allow authorized action", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      const contractAsOwner = await hre.viem.getContractAt(
        "MyContract",
        contract.address,
        { client: { wallet: owner } }
      );
      await contractAsOwner.write.doSomething([parseEther("1")]);
      // assert...
    });

    it("should revert for unauthorized caller", async function () {
      const { contract, user } = await loadFixture(deployFixture);
      const contractAsUser = await hre.viem.getContractAt(
        "MyContract",
        contract.address,
        { client: { wallet: user } }
      );
      await expect(contractAsUser.write.doSomething([1n])).to.be.rejected;
    });
  });

  describe("Time-dependent", function () {
    it("should unlock after cliff", async function () {
      const { contract } = await loadFixture(deployFixture);
      await time.increase(180 * 24 * 60 * 60); // 180 天
      // assert releasable amount...
    });
  });
});
```

### 流程拆解

```text
1. import（chai + hre + 按需的 network-helpers / viem）
        ↓
2. describe("合约名") 顶层套件
        ↓
3. deployFixture() — 部署合约，return { contract, accounts... }
        ↓
4. describe 按功能分组（Deployment / AccessControl / Burn / ...）
        ↓
5. it("should ...") — 每个用例只做一件事
        ↓
6. loadFixture(deployFixture) — 拿干净环境
        ↓
7. read / write / getContractAt — 与链交互
        ↓
8. expect(...) — 断言
```

---

## 6. 本仓库各合约测试 import 速查

| 合约 | 建议 import |
|------|-------------|
| `AstraToken` | `loadFixture`, `parseEther`, `zeroAddress` |
| `AstraVesting` | `loadFixture`, `time`, `parseEther` |
| `AstraStaking` | `loadFixture`, `time`, `parseEther` |
| `AstraReferral` | `loadFixture`, `parseEther` |
| `AstraBurnController` | `loadFixture`, `time`, `parseEther` |
| `Lock`（示例） | `loadFixture`, `time`, `parseGwei`, `getAddress` |

---

## 7. 常见模式对照表

| 你想测什么 | 怎么做 |
|------------|--------|
| 部署后初始状态 | fixture + `contract.read.xxx()` + `expect.equal` |
| 余额 / 总量 | `parseEther` + `balanceOf` / `totalSupply` |
| 零地址 revert | `zeroAddress` + `deployContract` + `rejectedWith` |
| 只有特定角色能调用 | `getContractAt` + 不同 wallet + `rejected` / `fulfilled` |
| 先授权再操作 | fixture 里 `grantRole`，或嵌套 fixture |
| 用户 A 转币给用户 B | `getContractAt` + A 的 wallet + `write.transfer` |
| 时间到了才能领取 | `time.increase` / `increaseTo` 后 assert |
| 合约收到 ETH | `getPublicClient` + `getBalance` |
| 触发了事件 | `write` → `waitForTransactionReceipt` → `getEvents.Xxx()` |

---

## 8. 嵌套 Fixture（进阶）

当一组测试需要「基础部署 + 额外设置」时，在基础 fixture 上再包一层：

```typescript
async function deployWithBurnerFixture() {
  const base = await loadFixture(deployAstraTokenFixture);
  const { token, adminSafe, burner } = base;

  const tokenAsAdmin = await hre.viem.getContractAt("AstraToken", token.address, {
    client: { wallet: adminSafe },
  });
  const burnerRole = await token.read.BURNER_ROLE();
  await tokenAsAdmin.write.grantRole([burnerRole, burner.account.address]);

  return { ...base, burnAmount: parseEther("1000") };
}
```

参考：`test/AstraToken.test.reference.ts` 中 `describe("Burn")` 部分。

---

## 9. 易错点

| 问题 | 正确做法 |
|------|----------|
| `balanceOf(addr)` 报错 | 写成 `balanceOf([addr])` |
| 大额数字精度丢失 | 用 `parseEther` / `1n`，不要用 JS `number` 算 wei |
| 测试互相影响 | 用 `loadFixture`，不要共用会变的全局变量 |
| 权限测试总是过/总是挂 | 检查是否用了 `getContractAt` 指定正确 wallet |
| `rejectedWith` 对不上 | 确认合约里 `require` 字符串或 custom error 名称一致 |
| 事件测不到 | `write` 后先 `waitForTransactionReceipt` 再 `getEvents` |

---

## 10. 建议学习顺序

1. 读 `test/Lock.ts` — 理解 fixture、time、revert、事件  
2. 读 `test/AstraToken.test.reference.ts` — 理解多账户、角色、分配比例  
3. 自己写 `test/AstraToken.test.ts` — 先 Deployment + Initial allocation  
4. 后续合约为 Vesting / Staking 加上 `time` 相关用例  

---

## 11. 与 Ethers 写法的区别（了解即可）

网上很多老教程用 `ethers.js` + `@nomicfoundation/hardhat-toolbox`（非 viem）。本仓库用的是 **Viem 版 toolbox**，主要差异：

| 操作 | Ethers（老） | Viem（本仓库） |
|------|--------------|----------------|
| 部署 | `ContractFactory.deploy()` | `hre.viem.deployContract()` |
| 只读 | `contract.foo()` | `contract.read.foo()` |
| 写入 | `contract.foo()` | `contract.write.foo([args])` |
| 单位 | `ethers.parseEther()` | `viem.parseEther()` |

不要混用两套 API 在同一个测试文件里。
