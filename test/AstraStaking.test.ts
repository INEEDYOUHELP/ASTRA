import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { parseEther, zeroAddress } from "viem";

const COMMUNITY_POOL = parseEther("300000000");
const MIN_REWARD_RESERVE = parseEther("3000000");
const REWARD_RATE = parseEther("1000");

describe("AstraStaking", function () {
  async function deployStakingFixture() {
    const [
      adminSafe,
      ecosystemFund,
      liquidityReserve,
      user1,
      user2,
      stranger,
    ] = await hre.viem.getWalletClients();

    const vesting = await hre.viem.deployContract("AstraVesting", [
      adminSafe.account.address,
    ]);

    const staking = await hre.viem.deployContract("AstraStaking", [
      adminSafe.account.address,
    ]);

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

    await stakingAsAdmin.write.setAstraToken([token.address]);
    await stakingAsAdmin.write.setRewardRatePerSec([REWARD_RATE]);

    return {
      staking,
      token,
      vesting,
      stakingAsAdmin,
      adminSafe,
      ecosystemFund,
      user1,
      user2,
      stranger,
    };
  }

  async function fundUser(
    token: Awaited<ReturnType<typeof deployStakingFixture>>["token"],
    from: Awaited<ReturnType<typeof deployStakingFixture>>["ecosystemFund"],
    to: Awaited<ReturnType<typeof deployStakingFixture>>["user1"],
    amount: bigint
  ) {
    const tokenAsFrom = await hre.viem.getContractAt("AstraToken", token.address, {
      client: { wallet: from },
    });
    await tokenAsFrom.write.transfer([to.account.address, amount]);
  }

  async function stakeAs(
    staking: Awaited<ReturnType<typeof deployStakingFixture>>["staking"],
    token: Awaited<ReturnType<typeof deployStakingFixture>>["token"],
    ecosystemFund: Awaited<ReturnType<typeof deployStakingFixture>>["ecosystemFund"],
    user: Awaited<ReturnType<typeof deployStakingFixture>>["user1"],
    amount: bigint
  ) {
    await fundUser(token, ecosystemFund, user, amount);
    const tokenAsUser = await hre.viem.getContractAt("AstraToken", token.address, {
      client: { wallet: user },
    });
    const stakingAsUser = await hre.viem.getContractAt(
      "AstraStaking",
      staking.address,
      { client: { wallet: user } }
    );

    await tokenAsUser.write.approve([staking.address, amount]);
    await stakingAsUser.write.stake([amount, zeroAddress]);
  }

  describe("Deployment", function () {
    it("should hold 300M ASTRA from initial token allocation", async function () {
      const { staking, token } = await loadFixture(deployStakingFixture);

      expect(await token.read.balanceOf([staking.address])).to.equal(COMMUNITY_POOL);
    });

    it("should bind astraToken via setAstraToken", async function () {
      const { staking, token } = await loadFixture(deployStakingFixture);

      expect((await staking.read.astraToken()).toLowerCase()).to.equal(
        token.address.toLowerCase()
      );
    });
  });

  describe("Staking rewards", function () {
    it("should increase pending reward over time for a single staker", async function () {
      const { staking, token, ecosystemFund, user1 } = await loadFixture(deployStakingFixture);

      const stakeAmount = parseEther("10000");
      await stakeAs(staking, token, ecosystemFund, user1, stakeAmount);

      expect(await staking.read.pendingReward([user1.account.address])).to.equal(0n);

      await time.increase(100n);

      const pending = await staking.read.pendingReward([user1.account.address]);
      expect(pending > 0n).to.equal(true);
    });

    it("should split rewards proportionally between two stakers", async function () {
      const { staking, token, ecosystemFund, user1, user2 } =
        await loadFixture(deployStakingFixture);

      await stakeAs(staking, token, ecosystemFund, user1, parseEther("1000"));
      await stakeAs(staking, token, ecosystemFund, user2, parseEther("3000"));

      await time.increase(200n);

      const pending1 = await staking.read.pendingReward([user1.account.address]);
      const pending2 = await staking.read.pendingReward([user2.account.address]);

      expect(pending2 > pending1).to.equal(true);
      const ratio = (pending2 * 100n) / pending1;
      expect(ratio > 250n && ratio < 350n).to.equal(true);
    });

    it("should pay rewards on claimReward", async function () {
      const { staking, token, ecosystemFund, user1 } = await loadFixture(deployStakingFixture);

      await stakeAs(staking, token, ecosystemFund, user1, parseEther("5000"));
      await time.increase(50n);

      const stakingAsUser1 = await hre.viem.getContractAt(
        "AstraStaking",
        staking.address,
        { client: { wallet: user1 } }
      );

      await stakingAsUser1.write.claimReward();

      const balance = await token.read.balanceOf([user1.account.address]);
      expect(balance > 0n).to.equal(true);
      expect(await staking.read.pendingReward([user1.account.address])).to.equal(0n);
    });
  });

  describe("Unstake", function () {
    it("should return principal on unstake", async function () {
      const { staking, token, ecosystemFund, user1 } = await loadFixture(deployStakingFixture);

      const stakeAmount = parseEther("8000");
      await stakeAs(staking, token, ecosystemFund, user1, stakeAmount);

      const stakingAsUser1 = await hre.viem.getContractAt(
        "AstraStaking",
        staking.address,
        { client: { wallet: user1 } }
      );

      const balanceBeforeUnstake = await token.read.balanceOf([user1.account.address]);
      expect(balanceBeforeUnstake).to.equal(0n);

      await stakingAsUser1.write.unstake([stakeAmount]);

      const balanceAfter = await token.read.balanceOf([user1.account.address]);
      expect(balanceAfter >= stakeAmount).to.equal(true);
      expect(await staking.read.totalStaked()).to.equal(0n);
    });
  });

  describe("Lock threshold", function () {
    async function deployHighRateFixture() {
      const base = await loadFixture(deployStakingFixture);
      await base.stakingAsAdmin.write.setRewardRatePerSec([parseEther("1000000")]);
      return base;
    }

    it("should trigger lock when reward pool drops below 3M", async function () {
      const { staking, token, ecosystemFund, user1 } = await loadFixture(deployHighRateFixture);

      await stakeAs(staking, token, ecosystemFund, user1, parseEther("1000000"));
      await time.increase(299n);

      const stakingAsUser1 = await hre.viem.getContractAt(
        "AstraStaking",
        staking.address,
        { client: { wallet: user1 } }
      );

      await stakingAsUser1.write.claimReward();

      expect(await staking.read.lockTriggered()).to.equal(true);
      expect((await staking.read.rewardPoolBalance()) < MIN_REWARD_RESERVE).to.equal(true);
    });

    it("should stop accruing new rewards after lock but allow unstake", async function () {
      const { staking, token, ecosystemFund, user1 } = await loadFixture(deployHighRateFixture);

      await stakeAs(staking, token, ecosystemFund, user1, parseEther("1000000"));
      await time.increase(299n);

      const stakingAsUser1 = await hre.viem.getContractAt(
        "AstraStaking",
        staking.address,
        { client: { wallet: user1 } }
      );

      await stakingAsUser1.write.claimReward();
      expect(await staking.read.lockTriggered()).to.equal(true);

      const pendingAfterLock = await staking.read.pendingReward([user1.account.address]);
      await time.increase(5_000n);
      const pendingLater = await staking.read.pendingReward([user1.account.address]);
      expect(pendingLater).to.equal(pendingAfterLock);

      await stakingAsUser1.write.unstake([parseEther("100000")]);
      expect(await staking.read.totalStaked()).to.equal(parseEther("900000"));
    });
  });

  describe("Access control", function () {
    it("should revert when non-admin sets reward rate", async function () {
      const { staking, stranger } = await loadFixture(deployStakingFixture);

      const stakingAsStranger = await hre.viem.getContractAt(
        "AstraStaking",
        staking.address,
        { client: { wallet: stranger } }
      );

      await expect(
        stakingAsStranger.write.setRewardRatePerSec([parseEther("1")])
      ).to.be.rejected;
    });
  });
});
