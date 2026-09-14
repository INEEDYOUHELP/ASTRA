import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";

// 可选：从环境变量读测试网（勿把私钥提交进仓库）
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {},
    // 示例：Base Sepolia；有 RPC_URL + PRIVATE_KEY 时才启用
    ...(RPC_URL && PRIVATE_KEY
      ? {
          baseSepolia: {
            url: RPC_URL,
            accounts: [PRIVATE_KEY],
          },
        }
      : {}),
  },
};

export default config;
