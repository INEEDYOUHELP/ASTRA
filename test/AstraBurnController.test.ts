import {
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { parseEther } from "viem";

const COMMUNITY_POOL = parseEther("300000000");
const REWARD_RATE = parseEther("1");

/**
 * M5 测试说明（对照 README 4.4 / 题目 4.2）：
 * - Oracle mock 写入 LP 新增 ETH、价格偏离
 * - 条件：netLiq < min 且 deviation > max 且同 epoch 未烧过
 * - burnAmount = min(pool × burnBps/10000, maxBurnPerEpoch)
 * - 从 Staking 奖励池划转后由 BurnController 调 token.burn
 */
describe("AstraBurnController", function () {
  async function deployBurnFixture() {
    const [
      adminSafe,
      ecosystemFund,
      liquidityReserve,
      keeper,
      stranger,
    ] = await hre.viem.getWalletClients();

    const vesting = await hre.viem.deployContract("AstraVesting", [
      adminSafe.account.address,
    ]);
    const staking = await hre.viem.deployContract("AstraStaking", [
      adminSafe.account.address,
    ]);
    const oracle = await hre.viem.deployContract("MockOracleAdapter", [
      adminSafe.account.address,
    ]);

    const token = await hre.viem.deployContract("AstraToken", [
      adminSafe.account.address,
      ecosystemFund.account.address,
      staking.address,
      vesting.address,
      liquidityReserve.account.address,
    ]);

    const burnController = await hre.viem.deployContract("AstraBurnController", [
      adminSafe.account.address,
      token.address,
      staking.address,
      oracle.address,
    ]);

    const stakingAsAdmin = await hre.viem.getContractAt(
      "AstraStaking",
      staking.address,
      { client: { wallet: adminSafe } }
    );
    const tokenAsAdmin = await hre.viem.getContractAt(
      "AstraToken",
      token.address,
      { client: { wallet: adminSafe } }
    );
    const burnAsAdmin = await hre.viem.getContractAt(
      "AstraBurnController",
      burnController.address,
      { client: { wallet: adminSafe } }
    );
    const oracleAsAdmin = await hre.viem.getContractAt(
      "MockOracleAdapter",
      oracle.address,
      { client: { wallet: adminSafe } }
    );

    await stakingAsAdmin.write.setAstraToken([token.address]);
    await stakingAsAdmin.write.setRewardRatePerSec([REWARD_RATE]);
    await stakingAsAdmin.write.setBurnController([burnController.address]);

    // Token.burn 只允许 BURNER_ROLE
    const burnerRole = await token.read.BURNER_ROLE();
    await tokenAsAdmin.write.grantRole([burnerRole, burnController.address]);

    // Keeper 角色给独立地址（admin 部署时已有 KEEPER，再授给 keeper）
    const keeperRole = await burnController.read.KEEPER_ROLE();
    await burnAsAdmin.write.grantRole([keeperRole, keeper.account.address]);

    // 默认参数：epoch 7 天；LP 最少要 1 ETH；偏离 > 3%；按池 1% 烧，单 epoch 上限 1M
    await burnAsAdmin.write.setParams([
      BigInt(7 * 24 * 60 * 60),
      parseEther("1"), // minLiquidityAddedETH
      300n, // maxPriceDeviationBps = 3%
      100n, // burnBps = 1%
      parseEther("1000000"), // maxBurnPerEpoch
    ]);

    return {
      token,
      staking,
      oracle,
      burnController,
      burnAsAdmin,
      oracleAsAdmin,
      adminSafe,
      keeper,
      stranger,
    };
  }

  async function setBadMarket(
    oracleAsAdmin: Awaited<ReturnType<typeof deployBurnFixture>>["oracleAsAdmin"]
  ) {
    // LP 新增 0.1 ETH < 1 ETH；偏离 500bps > 300bps → 应触发销毁
    await oracleAsAdmin.write.setMetrics([parseEther("0.1"), 500n]);
  }

  describe("配置", function () {
    it("应绑定 token / staking / oracle，并持有 BURNER_ROLE", async function () {
      const { token, staking, oracle, burnController } =
        await loadFixture(deployBurnFixture);

      expect((await burnController.read.astraToken()).toLowerCase()).to.equal(
        token.address.toLowerCase()
      );
      expect((await burnController.read.staking()).toLowerCase()).to.equal(
        staking.address.toLowerCase()
      );
      expect((await burnController.read.oracle()).toLowerCase()).to.equal(
        oracle.address.toLowerCase()
      );

      const burnerRole = await token.read.BURNER_ROLE();
      expect(
        await token.read.hasRole([burnerRole, burnController.address])
      ).to.equal(true);
    });
  });

  describe("checkAndBurn 条件", function () {
    it("条件满足时应销毁 min(pool×bps, max) 并减少总供应", async function () {
      const { token, staking, burnController, burnAsAdmin, oracleAsAdmin, keeper } =
        await loadFixture(deployBurnFixture);

      await setBadMarket(oracleAsAdmin);

      const pool = await staking.read.rewardPoolBalance();
      expect(pool).to.equal(COMMUNITY_POOL);

      const expected = parseEther("1000000"); // 300M * 1% = 3M，但被 max 卡到 1M
      expect(await burnController.read.previewBurnAmount()).to.equal(expected);

      const supplyBefore = await token.read.totalSupply();
      const burnAsKeeper = await hre.viem.getContractAt(
        "AstraBurnController",
        burnController.address,
        { client: { wallet: keeper } }
      );

      await burnAsKeeper.write.checkAndBurn();

      expect(await token.read.totalSupply()).to.equal(supplyBefore - expected);
      expect(await burnController.read.totalBurned()).to.equal(expected);
      expect(await staking.read.rewardPoolBalance()).to.equal(
        COMMUNITY_POOL - expected
      );
      expect(await token.read.balanceOf([burnController.address])).to.equal(0n);
    });

    it("同 epoch 不可重复销毁", async function () {
      const { burnController, oracleAsAdmin, keeper } =
        await loadFixture(deployBurnFixture);

      await setBadMarket(oracleAsAdmin);
      const burnAsKeeper = await hre.viem.getContractAt(
        "AstraBurnController",
        burnController.address,
        { client: { wallet: keeper } }
      );

      await burnAsKeeper.write.checkAndBurn();
      await expect(burnAsKeeper.write.checkAndBurn()).to.be.rejectedWith(
        "already burned this epoch"
      );
    });

    it("下一 epoch 在条件仍差时可再烧", async function () {
      const { token, burnController, oracleAsAdmin, keeper } =
        await loadFixture(deployBurnFixture);

      await setBadMarket(oracleAsAdmin);
      const burnAsKeeper = await hre.viem.getContractAt(
        "AstraBurnController",
        burnController.address,
        { client: { wallet: keeper } }
      );

      await burnAsKeeper.write.checkAndBurn();
      const afterFirst = await burnController.read.totalBurned();

      await time.increase(BigInt(7 * 24 * 60 * 60));
      await setBadMarket(oracleAsAdmin);
      await burnAsKeeper.write.checkAndBurn();

      expect(await burnController.read.totalBurned() > afterFirst).to.equal(true);
      expect(await token.read.balanceOf([burnController.address])).to.equal(0n);
    });

    it("LP 新增足够时不应销毁", async function () {
      const { burnController, oracleAsAdmin, keeper } =
        await loadFixture(deployBurnFixture);

      // netLiq = 2 ETH >= min 1 ETH
      await oracleAsAdmin.write.setMetrics([parseEther("2"), 500n]);

      const burnAsKeeper = await hre.viem.getContractAt(
        "AstraBurnController",
        burnController.address,
        { client: { wallet: keeper } }
      );
      await expect(burnAsKeeper.write.checkAndBurn()).to.be.rejectedWith(
        "liquidity ok"
      );
    });

    it("价格偏离不足时不应销毁", async function () {
      const { burnController, oracleAsAdmin, keeper } =
        await loadFixture(deployBurnFixture);

      // deviation 100 <= 300
      await oracleAsAdmin.write.setMetrics([parseEther("0.1"), 100n]);

      const burnAsKeeper = await hre.viem.getContractAt(
        "AstraBurnController",
        burnController.address,
        { client: { wallet: keeper } }
      );
      await expect(burnAsKeeper.write.checkAndBurn()).to.be.rejectedWith(
        "price ok"
      );
    });

    it("非 Keeper 不可调用 checkAndBurn", async function () {
      const { burnController, oracleAsAdmin, stranger } =
        await loadFixture(deployBurnFixture);

      await setBadMarket(oracleAsAdmin);
      const burnAsStranger = await hre.viem.getContractAt(
        "AstraBurnController",
        burnController.address,
        { client: { wallet: stranger } }
      );

      await expect(burnAsStranger.write.checkAndBurn()).to.be.rejected;
    });
  });

  describe("参数与安全", function () {
    it("burnBps 超过上限应失败", async function () {
      const { burnAsAdmin } = await loadFixture(deployBurnFixture);

      await expect(
        burnAsAdmin.write.setParams([
          BigInt(7 * 24 * 60 * 60),
          parseEther("1"),
          300n,
          1001n, // > MAX_BURN_BPS 1000
          parseEther("1"),
        ])
      ).to.be.rejectedWith("bad burnBps");
    });

    it("非 BurnController 不可 transferForBurn", async function () {
      const { staking, stranger } = await loadFixture(deployBurnFixture);

      const stakingAsStranger = await hre.viem.getContractAt(
        "AstraStaking",
        staking.address,
        { client: { wallet: stranger } }
      );

      await expect(
        stakingAsStranger.write.transferForBurn([parseEther("1")])
      ).to.be.rejectedWith("only burn controller");
    });
  });
});
