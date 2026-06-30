import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";

describe("AstraToken", function () {
    async function deployAstraTokenFixture() {
        const [
            adminSafe,
            ecosystemFund,
            communityRewardPool,
            vestingContract,
            liquidityReserve
        ] = await hre.viem.getWalletClients();

        

        
    }
});