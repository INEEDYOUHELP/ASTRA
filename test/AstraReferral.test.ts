import {
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { parseEther, zeroAddress } from "viem";

const COMMUNITY_POOL = parseEther("300000000");
const REWARD_RATE = parseEther("1000");

/**
 * M3 测试说明（对照规格 3.3）：
 * - 首质押可指定推荐人 → 推荐人得 5% 一次性奖励
 * - 奖励从社区奖励池（Staking 余额）扣除，转入 Referral 托管
 * - 推荐人手动 claimReferralReward
 * - 禁止自推荐；每人仅绑定一次
 */
describe("AstraReferral", function () {
  async function deployReferralFixture() {
    const [
      adminSafe,
      ecosystemFund,
      liquidityReserve,
      user, // 被推荐人（首次质押）
      referrer, // 推荐人
      stranger,
    ] = await hre.viem.getWalletClients();

    const vesting = await hre.viem.deployContract("AstraVesting", [
      adminSafe.account.address,
    ]);
    const staking = await hre.viem.deployContract("AstraStaking", [
      adminSafe.account.address,
    ]);
    const referral = await hre.viem.deployContract("AstraReferral", [
      adminSafe.account.address,
    ]);

    // 社区池 30% 铸到 Staking
    const token = await hre.viem.deployContract("AstraToken", [
      adminSafe.account.address,
      ecosystemFund.account.address,
      staking.address,
      vesting.address,
      liquidityReserve.account.address,
    ]);

    const stakingAsAdmin = await hre.viem.getContractAt(
      "AstraStaking",
      staking.address,
      { client: { wallet: adminSafe } }
    );
    const referralAsAdmin = await hre.viem.getContractAt(
      "AstraReferral",
      referral.address,
      { client: { wallet: adminSafe } }
    );

    await stakingAsAdmin.write.setAstraToken([token.address]);
    await stakingAsAdmin.write.setRewardRatePerSec([REWARD_RATE]);
    await stakingAsAdmin.write.setReferral([referral.address]);

    await referralAsAdmin.write.setAstraToken([token.address]);
    await referralAsAdmin.write.setStaking([staking.address]);

    return {
      token,
      staking,
      referral,
      stakingAsAdmin,
      referralAsAdmin,
      adminSafe,
      ecosystemFund,
      user,
      referrer,
      stranger,
    };
  }

  async function fundAndApproveStake(
    token: Awaited<ReturnType<typeof deployReferralFixture>>["token"],
    staking: Awaited<ReturnType<typeof deployReferralFixture>>["staking"],
    ecosystemFund: Awaited<ReturnType<typeof deployReferralFixture>>["ecosystemFund"],
    user: Awaited<ReturnType<typeof deployReferralFixture>>["user"],
    amount: bigint
  ) {
    const tokenAsFund = await hre.viem.getContractAt("AstraToken", token.address, {
      client: { wallet: ecosystemFund },
    });
    await tokenAsFund.write.transfer([user.account.address, amount]);

    const tokenAsUser = await hre.viem.getContractAt("AstraToken", token.address, {
      client: { wallet: user },
    });
    await tokenAsUser.write.approve([staking.address, amount]);
  }

  describe("配置", function () {
    it("应绑定 token 与 staking", async function () {
      const { referral, token, staking } = await loadFixture(deployReferralFixture);

      expect((await referral.read.astraToken()).toLowerCase()).to.equal(
        token.address.toLowerCase()
      );
      expect((await referral.read.staking()).toLowerCase()).to.equal(
        staking.address.toLowerCase()
      );
      expect(await referral.read.REFERRAL_BPS()).to.equal(500n);
    });
  });

  describe("首质押绑定 + 5% 记账", function () {
    it("首次 stake 指定推荐人后，pending = 质押量 * 5%", async function () {
      const { token, staking, referral, ecosystemFund, user, referrer } =
        await loadFixture(deployReferralFixture);

      const stakeAmount = parseEther("10000");
      const expectedReward = (stakeAmount * 500n) / 10_000n; // 500 ASTRA

      await fundAndApproveStake(token, staking, ecosystemFund, user, stakeAmount);

      const poolBefore = await token.read.balanceOf([staking.address]);
      expect(poolBefore).to.equal(COMMUNITY_POOL);

      const stakingAsUser = await hre.viem.getContractAt(
        "AstraStaking",
        staking.address,
        { client: { wallet: user } }
      );
      await stakingAsUser.write.stake([stakeAmount, referrer.account.address]);

      // 绑定关系
      expect(
        (await referral.read.referrerOf([user.account.address])).toLowerCase()
      ).to.equal(referrer.account.address.toLowerCase());

      // 记账金额
      expect(
        await referral.read.pendingReferralReward([referrer.account.address])
      ).to.equal(expectedReward);

      // 社区池已划出 5% 到 Referral 托管
      expect(await token.read.balanceOf([referral.address])).to.equal(expectedReward);
      expect(await token.read.balanceOf([staking.address])).to.equal(
        COMMUNITY_POOL + stakeAmount - expectedReward
      );
    });

    it("第二次 stake 不再触发推荐（仅绑定一次）", async function () {
      const { token, staking, referral, ecosystemFund, user, referrer, stranger } =
        await loadFixture(deployReferralFixture);

      const first = parseEther("10000");
      const second = parseEther("20000");
      const expectedFirstReward = (first * 500n) / 10_000n;

      await fundAndApproveStake(token, staking, ecosystemFund, user, first + second);
      const stakingAsUser = await hre.viem.getContractAt(
        "AstraStaking",
        staking.address,
        { client: { wallet: user } }
      );

      await stakingAsUser.write.stake([first, referrer.account.address]);
      // 再次 stake，即使传入另一个地址，也不会改绑 / 不再发推荐奖
      await stakingAsUser.write.stake([second, stranger.account.address]);

      expect(
        (await referral.read.referrerOf([user.account.address])).toLowerCase()
      ).to.equal(referrer.account.address.toLowerCase());
      expect(
        await referral.read.pendingReferralReward([referrer.account.address])
      ).to.equal(expectedFirstReward);
      expect(
        await referral.read.pendingReferralReward([stranger.account.address])
      ).to.equal(0n);
    });

    it("自推荐应整笔 stake 回滚", async function () {
      const { token, staking, ecosystemFund, user } =
        await loadFixture(deployReferralFixture);

      const amount = parseEther("1000");
      await fundAndApproveStake(token, staking, ecosystemFund, user, amount);

      const stakingAsUser = await hre.viem.getContractAt(
        "AstraStaking",
        staking.address,
        { client: { wallet: user } }
      );

      await expect(
        stakingAsUser.write.stake([amount, user.account.address])
      ).to.be.rejectedWith("self referral");

      expect(await staking.read.totalStaked()).to.equal(0n);
    });

    it("未指定推荐人时不记账、不划转", async function () {
      const { token, staking, referral, ecosystemFund, user } =
        await loadFixture(deployReferralFixture);

      const amount = parseEther("5000");
      await fundAndApproveStake(token, staking, ecosystemFund, user, amount);

      const stakingAsUser = await hre.viem.getContractAt(
        "AstraStaking",
        staking.address,
        { client: { wallet: user } }
      );
      await stakingAsUser.write.stake([amount, zeroAddress]);

      expect(await referral.read.referrerOf([user.account.address])).to.equal(
        zeroAddress
      );
      expect(await token.read.balanceOf([referral.address])).to.equal(0n);
      expect(await token.read.balanceOf([staking.address])).to.equal(
        COMMUNITY_POOL + amount
      );
    });
  });

  describe("领取推荐奖励", function () {
    it("推荐人 claim 后余额增加，pending 清零", async function () {
      const { token, staking, referral, ecosystemFund, user, referrer } =
        await loadFixture(deployReferralFixture);

      const stakeAmount = parseEther("20000");
      const expectedReward = (stakeAmount * 500n) / 10_000n;

      await fundAndApproveStake(token, staking, ecosystemFund, user, stakeAmount);
      const stakingAsUser = await hre.viem.getContractAt(
        "AstraStaking",
        staking.address,
        { client: { wallet: user } }
      );
      await stakingAsUser.write.stake([stakeAmount, referrer.account.address]);

      const referralAsReferrer = await hre.viem.getContractAt(
        "AstraReferral",
        referral.address,
        { client: { wallet: referrer } }
      );

      const before = await token.read.balanceOf([referrer.account.address]);
      await referralAsReferrer.write.claimReferralReward();
      const after = await token.read.balanceOf([referrer.account.address]);

      expect(after - before).to.equal(expectedReward);
      expect(
        await referral.read.pendingReferralReward([referrer.account.address])
      ).to.equal(0n);
      expect(await token.read.balanceOf([referral.address])).to.equal(0n);
    });

    it("无 pending 时 claim 应失败", async function () {
      const { referral, stranger } = await loadFixture(deployReferralFixture);

      const referralAsStranger = await hre.viem.getContractAt(
        "AstraReferral",
        referral.address,
        { client: { wallet: stranger } }
      );

      await expect(
        referralAsStranger.write.claimReferralReward()
      ).to.be.rejectedWith("nothing to claim");
    });
  });

  describe("权限与安全", function () {
    it("非 Staking 地址不可直接 accrueOnFirstStake", async function () {
      const { referral, user, referrer, stranger } =
        await loadFixture(deployReferralFixture);

      const referralAsStranger = await hre.viem.getContractAt(
        "AstraReferral",
        referral.address,
        { client: { wallet: stranger } }
      );

      await expect(
        referralAsStranger.write.accrueOnFirstStake([
          user.account.address,
          parseEther("1000"),
          referrer.account.address,
        ])
      ).to.be.rejectedWith("only staking");
    });

    it("非 admin 不可 setStaking", async function () {
      const { referral, stranger } = await loadFixture(deployReferralFixture);

      const referralAsStranger = await hre.viem.getContractAt(
        "AstraReferral",
        referral.address,
        { client: { wallet: stranger } }
      );

      await expect(
        referralAsStranger.write.setStaking([stranger.account.address])
      ).to.be.rejected;
    });
  });

  describe("与 Staking 奖励并存（集成）", function () {
    it("划出推荐奖后，质押奖励仍可正常累计与领取", async function () {
      const { token, staking, referral, ecosystemFund, user, referrer } =
        await loadFixture(deployReferralFixture);

      const stakeAmount = parseEther("10000");
      const referralReward = (stakeAmount * 500n) / 10_000n;

      await fundAndApproveStake(token, staking, ecosystemFund, user, stakeAmount);
      const stakingAsUser = await hre.viem.getContractAt(
        "AstraStaking",
        staking.address,
        { client: { wallet: user } }
      );
      await stakingAsUser.write.stake([stakeAmount, referrer.account.address]);

      expect(await token.read.balanceOf([referral.address])).to.equal(referralReward);

      await time.increase(100n);
      const pending = await staking.read.pendingReward([user.account.address]);
      expect(pending > 0n).to.equal(true);

      await stakingAsUser.write.claimReward();
      expect(await staking.read.pendingReward([user.account.address])).to.equal(0n);

      // 推荐人仍可领推荐奖（互不影响）
      const referralAsReferrer = await hre.viem.getContractAt(
        "AstraReferral",
        referral.address,
        { client: { wallet: referrer } }
      );
      await referralAsReferrer.write.claimReferralReward();
      expect(await token.read.balanceOf([referrer.account.address])).to.equal(
        referralReward
      );
    });
  });
});
