import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseEther } from "viem";

// 时间都用秒，后面测试里直接加减
const DAY = 24n * 60n * 60n;
const TEAM_CLIFF = 180n * DAY;       // 团队 6 个月 cliff
const TEAM_DURATION = 730n * DAY;    // cliff 过后再线性 24 个月
const INVESTOR_DURATION = 548n * DAY; // 投资者 18 个月线性，无 cliff

const TEAM_AMOUNT = parseEther("150000000");
const INVESTOR_AMOUNT = parseEther("100000000");
const VESTING_TOTAL = parseEther("250000000");

describe("AstraVesting", function () {
  // 每个测试都会走一遍这套部署，loadFixture 会帮你快照复用，不用重复写
  async function deployVestingFixture() {
    const [
      adminSafe,
      ecosystemFund,
      communityRewardPool,
      teamBeneficiary,
      investorBeneficiary,
      liquidityReserve,
      stranger,
    ] = await hre.viem.getWalletClients();

    // 先部署 vesting，再部署 token（token 会把 2.5 亿 mint 到 vesting 地址）
    const vesting = await hre.viem.deployContract("AstraVesting", [
      adminSafe.account.address,
    ]);

    const token = await hre.viem.deployContract("AstraToken", [
      adminSafe.account.address,
      ecosystemFund.account.address,
      communityRewardPool.account.address,
      vesting.address,
      liquidityReserve.account.address,
    ]);

    const tokenDeployTime = BigInt(await time.latest());

    // 管理员才能 setToken / createSchedule，所以单独拿一个 admin 身份的实例
    const vestingAsAdmin = await hre.viem.getContractAt(
      "AstraVesting",
      vesting.address,
      { client: { wallet: adminSafe } }
    );

    await vestingAsAdmin.write.setAstraToken([token.address]);

    await vestingAsAdmin.write.createSchedule([
      teamBeneficiary.account.address,
      TEAM_AMOUNT,
      tokenDeployTime,
      TEAM_CLIFF,
      TEAM_DURATION,
    ]);

    const investorStart = BigInt(await time.latest());
    await vestingAsAdmin.write.createSchedule([
      investorBeneficiary.account.address,
      INVESTOR_AMOUNT,
      investorStart,
      0n,
      INVESTOR_DURATION,
    ]);

    return {
      vesting,
      token,
      vestingAsAdmin,
      adminSafe,
      teamBeneficiary,
      investorBeneficiary,
      stranger,
      tokenDeployTime,
      investorStart,
    };
  }

  // 只部署合约、绑定 token，不创建 schedule，给权限测试用
  async function deployBareVestingFixture() {
    const [
      adminSafe,
      ecosystemFund,
      communityRewardPool,
      teamBeneficiary,
      liquidityReserve,
      stranger,
    ] = await hre.viem.getWalletClients();

    const vesting = await hre.viem.deployContract("AstraVesting", [
      adminSafe.account.address,
    ]);

    const token = await hre.viem.deployContract("AstraToken", [
      adminSafe.account.address,
      ecosystemFund.account.address,
      communityRewardPool.account.address,
      vesting.address,
      liquidityReserve.account.address,
    ]);

    const vestingAsAdmin = await hre.viem.getContractAt(
      "AstraVesting",
      vesting.address,
      { client: { wallet: adminSafe } }
    );

    const vestingAsStranger = await hre.viem.getContractAt(
      "AstraVesting",
      vesting.address,
      { client: { wallet: stranger } }
    );

    await vestingAsAdmin.write.setAstraToken([token.address]);

    return {
      vesting,
      token,
      vestingAsAdmin,
      vestingAsStranger,
      teamBeneficiary,
      tokenDeployTime: BigInt(await time.latest()),
    };
  }

  describe("Deployment", function () {
    it("should hold 250M ASTRA minted by AstraToken", async function () {
      const { vesting, token } = await loadFixture(deployVestingFixture);

      expect(await token.read.balanceOf([vesting.address])).to.equal(VESTING_TOTAL);
    });

    it("should bind astraToken once via setAstraToken", async function () {
      const { vesting, token } = await loadFixture(deployVestingFixture);

      expect(getAddress(await vesting.read.astraToken())).to.equal(
        getAddress(token.address)
      );
    });
  });

  describe("Team vesting", function () {
    it("should have zero releasable before cliff ends", async function () {
      const { vesting, teamBeneficiary, tokenDeployTime } =
        await loadFixture(deployVestingFixture);

      // 快进到 cliff 最后一秒之前，应该还是 0
      await time.increaseTo(tokenDeployTime + TEAM_CLIFF - 1n);

      expect(
        await vesting.read.releasable([teamBeneficiary.account.address])
      ).to.equal(0n);
    });

    it("should release linearly after cliff (50% at mid linear period)", async function () {
      const { vesting, teamBeneficiary, tokenDeployTime } =
        await loadFixture(deployVestingFixture);

      await time.increaseTo(tokenDeployTime + TEAM_CLIFF + TEAM_DURATION / 2n);

      const releasable = await vesting.read.releasable([
        teamBeneficiary.account.address,
      ]);
      expect(releasable).to.equal(TEAM_AMOUNT / 2n);
    });

    it("should allow team to claim full 150M after vesting ends", async function () {
      const { vesting, token, teamBeneficiary, tokenDeployTime } =
        await loadFixture(deployVestingFixture);

      await time.increaseTo(tokenDeployTime + TEAM_CLIFF + TEAM_DURATION);

      const vestingAsTeam = await hre.viem.getContractAt(
        "AstraVesting",
        vesting.address,
        { client: { wallet: teamBeneficiary } }
      );

      await vestingAsTeam.write.release();

      expect(await token.read.balanceOf([teamBeneficiary.account.address])).to.equal(
        TEAM_AMOUNT
      );
      expect(
        await vesting.read.releasable([teamBeneficiary.account.address])
      ).to.equal(0n);
    });
  });

  describe("Investor vesting", function () {
    it("should have releasable right after start (no cliff)", async function () {
      const { vesting, investorBeneficiary, investorStart } =
        await loadFixture(deployVestingFixture);

      // 投资者无 cliff，计划开始后过一天就应该能领到一点
      await time.increaseTo(investorStart + DAY);

      const releasable = await vesting.read.releasable([
        investorBeneficiary.account.address,
      ]);
      expect(releasable > 0n).to.equal(true);
    });

    it("should release linearly with no cliff (50% at mid period)", async function () {
      const { vesting, investorBeneficiary, investorStart } =
        await loadFixture(deployVestingFixture);

      await time.increaseTo(investorStart + INVESTOR_DURATION / 2n);

      const releasable = await vesting.read.releasable([
        investorBeneficiary.account.address,
      ]);
      expect(releasable).to.equal(INVESTOR_AMOUNT / 2n);
    });

    it("should allow investor to claim full 100M after vesting ends", async function () {
      const { vesting, token, investorBeneficiary, investorStart } =
        await loadFixture(deployVestingFixture);

      await time.increaseTo(investorStart + INVESTOR_DURATION);

      const vestingAsInvestor = await hre.viem.getContractAt(
        "AstraVesting",
        vesting.address,
        { client: { wallet: investorBeneficiary } }
      );

      await vestingAsInvestor.write.release();

      expect(
        await token.read.balanceOf([investorBeneficiary.account.address])
      ).to.equal(INVESTOR_AMOUNT);
    });
  });

  describe("Release rules", function () {
    it("should revert when account has no schedule", async function () {
      const { vesting, stranger } = await loadFixture(deployVestingFixture);

      const vestingAsStranger = await hre.viem.getContractAt(
        "AstraVesting",
        vesting.address,
        { client: { wallet: stranger } }
      );

      await expect(vestingAsStranger.write.release()).to.be.rejectedWith(
        "nothing to release"
      );
    });

    it("should only release incremental amount on second claim", async function () {
      const { vesting, token, investorBeneficiary, investorStart } =
        await loadFixture(deployVestingFixture);

      const vestingAsInvestor = await hre.viem.getContractAt(
        "AstraVesting",
        vesting.address,
        { client: { wallet: investorBeneficiary } }
      );

      // 第一次：释放期走到 25%
      await time.increaseTo(investorStart + INVESTOR_DURATION / 4n);
      await vestingAsInvestor.write.release();

      const balanceAfterFirst = await token.read.balanceOf([
        investorBeneficiary.account.address,
      ]);
      expect(balanceAfterFirst > 0n).to.equal(true);
      expect(
        await vesting.read.releasable([investorBeneficiary.account.address])
      ).to.equal(0n);

      // 第二次：再走到 50%，应该还能领差额
      await time.increaseTo(investorStart + INVESTOR_DURATION / 2n);
      const releasableBeforeSecond = await vesting.read.releasable([
        investorBeneficiary.account.address,
      ]);
      expect(releasableBeforeSecond > 0n).to.equal(true);

      await vestingAsInvestor.write.release();

      const balanceAfterSecond = await token.read.balanceOf([
        investorBeneficiary.account.address,
      ]);
      expect(balanceAfterSecond > balanceAfterFirst).to.equal(true);
      expect(
        await vesting.read.releasable([investorBeneficiary.account.address])
      ).to.equal(0n);
    });
  });

  describe("Access control & validations", function () {
    it("should revert when non-admin calls setAstraToken", async function () {
      const [adminSafe, ecosystemFund, communityRewardPool, liquidityReserve, stranger] =
        await hre.viem.getWalletClients();

      const vesting = await hre.viem.deployContract("AstraVesting", [
        adminSafe.account.address,
      ]);

      const token = await hre.viem.deployContract("AstraToken", [
        adminSafe.account.address,
        ecosystemFund.account.address,
        communityRewardPool.account.address,
        vesting.address,
        liquidityReserve.account.address,
      ]);

      const vestingAsStranger = await hre.viem.getContractAt(
        "AstraVesting",
        vesting.address,
        { client: { wallet: stranger } }
      );

      await expect(
        vestingAsStranger.write.setAstraToken([token.address])
      ).to.be.rejected;
    });

    it("should revert when non-admin calls createSchedule", async function () {
      const { vestingAsStranger, teamBeneficiary, tokenDeployTime } =
        await loadFixture(deployBareVestingFixture);

      await expect(
        vestingAsStranger.write.createSchedule([
          teamBeneficiary.account.address,
          TEAM_AMOUNT,
          tokenDeployTime,
          TEAM_CLIFF,
          TEAM_DURATION,
        ])
      ).to.be.rejected;
    });

    it("should revert when setAstraToken is called twice", async function () {
      const { vestingAsAdmin, token } = await loadFixture(deployBareVestingFixture);

      await expect(
        vestingAsAdmin.write.setAstraToken([token.address])
      ).to.be.rejectedWith("token already set");
    });

    it("should revert when creating duplicate schedule for same beneficiary", async function () {
      const { vestingAsAdmin, teamBeneficiary, tokenDeployTime } =
        await loadFixture(deployVestingFixture);

      await expect(
        vestingAsAdmin.write.createSchedule([
          teamBeneficiary.account.address,
          TEAM_AMOUNT,
          tokenDeployTime,
          TEAM_CLIFF,
          TEAM_DURATION,
        ])
      ).to.be.rejectedWith("schedule exists");
    });
  });
});
