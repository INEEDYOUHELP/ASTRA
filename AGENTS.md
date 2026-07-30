# Astra — Agent 说明

去中心化内容创作与策展平台的代币经济实现（Hardhat + OpenZeppelin + TypeScript）。

## 优先阅读

1. `README.md` — 经济模型、角色、里程碑  
2. `.cursor/rules/` — 长期约定  
3. `contracts/*.reference.sol` — 学习参考实现  

## 常用命令

```bash
npm install
npx hardhat compile
npx hardhat test
```

## Skills

| Skill | 何时用 |
|-------|--------|
| `deploy-check` | 部署 / 上线前验收 |
| `code-review` | 审合约、PR、安全检查 |

## 约定摘要

- 正式合约勿只改 `*.reference.*`；参考文件供对照学习。  
- 勿提交 `.env` / 私钥。  
- Hooks / 机器人自动化尚未配置，后续再加。  
