import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { parseEther, zeroAddress } from "viem";

describe("AstraToken (reference)", function () {
    // ---------------------------------------------------------------------------
    // Fixture: deploy once per test group, reset via snapshot (same pattern as Lock.ts)
    // ---------------------------------------------------------------------------
    async function deployAstraTokenFixture() {
        const [
            adminSafe,
            ecosystemFund,
            communityRewardPool,
            vestingContract,
            liquidityReserve,
            burner,
            stranger,
        ] = await hre.viem.getWalletClients();

        const token = await hre.viem.deployContract("AstraToken", [
            adminSafe.account.address,
            ecosystemFund.account.address,
            communityRewardPool.account.address,
            vestingContract.account.address,
            liquidityReserve.account.address,
        ]);

        return {
            token,
            adminSafe,
            ecosystemFund,
            communityRewardPool,
            vestingContract,
            liquidityReserve,
            burner,
            stranger,
        };
    }

    // ---------------------------------------------------------------------------
    // 1) Metadata & total supply
    // ---------------------------------------------------------------------------
    describe("Deployment", function () {
        it("should set name and symbol", async function () {
            const { token } = await loadFixture(deployAstraTokenFixture);

            expect(await token.read.name()).to.equal("AstraToken");
            expect(await token.read.symbol()).to.equal("ASTRA");
        });

        it("should mint exactly 1 billion tokens total", async function () {
            const { token } = await loadFixture(deployAstraTokenFixture);

            expect(await token.read.totalSupply()).to.equal(parseEther("1000000000"));
            expect(await token.read.TOTAL_SUPPLY()).to.equal(parseEther("1000000000"));
        });

        it("should reject zero adminSafe address", async function () {
            const [, ecosystemFund, communityRewardPool, vestingContract, liquidityReserve] =
                await hre.viem.getWalletClients();

            await expect(
                hre.viem.deployContract("AstraToken", [
                    zeroAddress,
                    ecosystemFund.account.address,
                    communityRewardPool.account.address,
                    vestingContract.account.address,
                    liquidityReserve.account.address,
                ])
            ).to.be.rejectedWith("adminSafe=0");
        });
    });

    // ---------------------------------------------------------------------------
    // 2) Initial allocation (40 / 30 / 25 / 5)
    // ---------------------------------------------------------------------------
    describe("Initial allocation", function () {
        it("should allocate 40% to ecosystem fund", async function () {
            const { token, ecosystemFund } = await loadFixture(deployAstraTokenFixture);

            expect(await token.read.balanceOf([ecosystemFund.account.address])).to.equal(
                parseEther("400000000")
            );
        });

        it("should allocate 30% to community reward pool (staking)", async function () {
            const { token, communityRewardPool } = await loadFixture(deployAstraTokenFixture);

            expect(
                await token.read.balanceOf([communityRewardPool.account.address])
            ).to.equal(parseEther("300000000"));
        });

        it("should allocate 25% to vesting contract (team 15% + investor 10%)", async function () {
            const { token, vestingContract } = await loadFixture(deployAstraTokenFixture);

            // Your contract mints 150M + 100M to the same vesting address
            expect(await token.read.balanceOf([vestingContract.account.address])).to.equal(
                parseEther("250000000")
            );
        });

        it("should allocate 5% to liquidity reserve", async function () {
            const { token, liquidityReserve } = await loadFixture(deployAstraTokenFixture);

            expect(await token.read.balanceOf([liquidityReserve.account.address])).to.equal(
                parseEther("50000000")
            );
        });
    });

    // ---------------------------------------------------------------------------
    // 3) AccessControl — admin role
    // ---------------------------------------------------------------------------
    describe("AccessControl", function () {
        it("should grant DEFAULT_ADMIN_ROLE to adminSafe", async function () {
            const { token, adminSafe } = await loadFixture(deployAstraTokenFixture);

            const defaultAdminRole = await token.read.DEFAULT_ADMIN_ROLE();
            const hasRole = await token.read.hasRole([
                defaultAdminRole,
                adminSafe.account.address,
            ]);

            expect(hasRole).to.equal(true);
        });

        it("should allow admin to grant BURNER_ROLE", async function () {
            const { token, adminSafe, burner } = await loadFixture(deployAstraTokenFixture);

            const tokenAsAdmin = await hre.viem.getContractAt("AstraToken", token.address, {
                client: { wallet: adminSafe },
            });

            const burnerRole = await token.read.BURNER_ROLE();
            await tokenAsAdmin.write.grantRole([burnerRole, burner.account.address]);

            expect(
                await token.read.hasRole([burnerRole, burner.account.address])
            ).to.equal(true);
        });
    });

    // ---------------------------------------------------------------------------
    // 4) Burn — only BURNER_ROLE
    // ---------------------------------------------------------------------------
    describe("Burn", function () {
        async function deployWithBurnerFixture() {
            const base = await loadFixture(deployAstraTokenFixture);
            const { token, adminSafe, burner, ecosystemFund } = base;

            const tokenAsAdmin = await hre.viem.getContractAt("AstraToken", token.address, {
                client: { wallet: adminSafe },
            });
            const burnerRole = await token.read.BURNER_ROLE();
            await tokenAsAdmin.write.grantRole([burnerRole, burner.account.address]);

            // Move some tokens to burner so burn() has something to destroy
            const fundAsSender = await hre.viem.getContractAt("AstraToken", token.address, {
                client: { wallet: ecosystemFund },
            });
            const burnAmount = parseEther("1000");
            await fundAsSender.write.transfer([burner.account.address, burnAmount]);

            return { ...base, burnAmount };
        }

        it("should allow burner to burn own balance", async function () {
            const { token, burner, burnAmount } = await loadFixture(deployWithBurnerFixture);

            const tokenAsBurner = await hre.viem.getContractAt("AstraToken", token.address, {
                client: { wallet: burner },
            });

            const supplyBefore = await token.read.totalSupply();
            const balanceBefore = await token.read.balanceOf([burner.account.address]);

            await tokenAsBurner.write.burn([burnAmount]);

            expect(await token.read.balanceOf([burner.account.address])).to.equal(
                balanceBefore - burnAmount
            );
            expect(await token.read.totalSupply()).to.equal(supplyBefore - burnAmount);
        });

        it("should revert when non-burner calls burn", async function () {
            const { token, stranger } = await loadFixture(deployWithBurnerFixture);

            const tokenAsStranger = await hre.viem.getContractAt("AstraToken", token.address, {
                client: { wallet: stranger },
            });

            await expect(tokenAsStranger.write.burn([1n])).to.be.rejected;
        });
    });

    // ---------------------------------------------------------------------------
    // 5) Permit extension (smoke check — ERC20Permit is wired)
    // ---------------------------------------------------------------------------
    describe("Permit", function () {
        it("should expose nonces for permit flow", async function () {
            const { token, ecosystemFund } = await loadFixture(deployAstraTokenFixture);

            const nonce = await token.read.nonces([ecosystemFund.account.address]);
            expect(nonce).to.equal(0n);
        });
    });
});
