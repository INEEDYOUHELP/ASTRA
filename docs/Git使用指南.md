# Git 常用命令与 GitHub 上传流程

> 适用于 Astra 项目：按开发阶段提交，让每一步都有记录。

---

## 1. 首次配置（只需做一次）

```bash
# 查看当前配置
git config --list

# 设置用户名和邮箱（会显示在 commit 记录里）
git config --global user.name "你的名字"
git config --global user.email "你的邮箱@example.com"

# 查看配置是否生效
git config user.name
git config user.email
```

---

## 2. 常用命令速查

### 2.1 查看状态

```bash
# 查看工作区状态：哪些文件改了、哪些未跟踪
git status

# 查看具体改动内容
git diff

# 查看已暂存（git add 后）的改动
git diff --staged

# 查看提交历史
git log

# 简洁一行显示历史
git log --oneline

# 图形化显示分支
git log --oneline --graph --all
```

### 2.2 暂存与提交

```bash
# 暂存单个文件
git add docs/SPEC.md

# 暂存某个目录下所有变更
git add docs/

# 暂存所有变更（新文件 + 修改 + 删除）
git add .

# 提交（-m 后面写清楚这次做了什么）
git commit -m "docs: 添加合约规格文档 SPEC"

# 修改上一次提交说明（还没 push 时可用）
git commit --amend -m "新的提交说明"
```

### 2.3 撤销与回退

```bash
# 撤销工作区对某个文件的修改（未 add 的改动会丢失）
git restore 文件名

# 取消暂存（已 add，但未 commit）
git restore --staged 文件名

# 回退到某个提交（保留工作区改动）
git reset --soft 提交hash

# 回退到某个提交（丢弃之后的提交，慎用）
git reset --hard 提交hash
```

### 2.4 分支

```bash
# 查看分支
git branch

# 创建并切换到新分支
git checkout -b feature/staking

# 新版 Git 也可用
git switch -c feature/staking

# 切换分支
git checkout main
git switch main

# 合并分支到当前分支
git merge feature/staking

# 删除已合并的本地分支
git branch -d feature/staking
```

### 2.5 远程仓库

```bash
# 查看远程地址
git remote -v

# 添加远程仓库（GitHub 仓库地址）
git remote add origin https://github.com/你的用户名/Aster.git

# 修改远程地址
git remote set-url origin https://github.com/你的用户名/Aster.git

# 拉取远程更新
git pull origin main

# 推送到远程
git push origin main

# 首次推送并建立跟踪关系
git push -u origin main
```

### 2.6 标签（可选，用于里程碑）

```bash
# 给当前提交打标签（例如完成 M1）
git tag v0.1-token-vesting

# 推送标签到 GitHub
git push origin v0.1-token-vesting

# 推送所有标签
git push origin --tags
```

---

## 3. GitHub 首次上传完整流程

### 步骤 1：在 GitHub 创建空仓库

1. 打开 [https://github.com/new](https://github.com/new)
2. 仓库名例如：`Aster`
3. 选择 **Public** 或 **Private**
4. **不要**勾选 "Add a README"（本地已有项目时避免冲突）
5. 创建后复制仓库地址，例如：
   `https://github.com/你的用户名/Aster.git`

### 步骤 2：本地准备 `.gitignore`

在项目根目录创建 `.gitignore`，避免把敏感信息和构建产物提交上去：

```gitignore
# 环境变量与密钥（切勿提交）
.env
.env.*
*.pem

# Node
node_modules/
dist/
.next/

# Foundry / Hardhat
out/
cache/
broadcast/
artifacts/
typechain-types/

# IDE
.idea/
.vscode/
*.swp

# 系统文件
.DS_Store
Thumbs.db
```

### 步骤 3：首次提交并推送

在项目根目录 `d:\Code\Aster` 执行：

```bash
# 确认在正确目录
cd d:\Code\Aster

# 查看状态
git status

# 添加所有应跟踪的文件
git add .

# 再次确认将要提交的内容
git status

# 首次提交
git commit -m "chore: 初始化项目文档与架构设计"

# 添加远程仓库（把 URL 换成你自己的）
git remote add origin https://github.com/你的用户名/Aster.git

# 如果远程默认分支是 main
git branch -M main

# 首次推送
git push -u origin main
```

如果 GitHub 提示需要登录，可使用：

- **HTTPS**：Personal Access Token（PAT）作为密码
- **SSH**：配置 SSH key 后使用 `git@github.com:用户名/Aster.git`

---

## 4. 日常开发上传流程（推荐习惯）

每完成一个小目标就提交一次，不要攒很多天再提交。

```bash
# 1. 开始前先看一眼状态
git status

# 2. 开发、写代码、跑测试...

# 3. 查看改了什么
git diff

# 4. 只暂存本次相关的文件（比 git add . 更稳妥）
git add contracts/AstraToken.sol
git add test/AstraToken.t.sol

# 5. 提交（说明写「为什么」，而不只是「改了什么」）
git commit -m "feat(token): 实现 ERC20 固定总量与初始分配"

# 6. 推送到 GitHub
git push
```

如果多人协作或你在多台电脑开发，推送前先拉取：

```bash
git pull --rebase origin main
git push
```

---

## 5. 结合 Astra 项目的提交节奏建议

按 `详细开发流程.md` 的里程碑，建议这样拆分 commit：

| 阶段 | 建议 commit 说明示例 |
|------|----------------------|
| 环境搭建 | `chore: 初始化 Foundry 工程与依赖` |
| SPEC 文档 | `docs: 完成全合约 SPEC 规格` |
| Token | `feat(token): 实现 ASTRA 代币与初始分配` |
| Vesting | `feat(vesting): 实现多受益人线性释放` |
| Staking | `feat(staking): 实现质押奖励与 1% 阈值锁定` |
| Referral | `feat(referral): 实现首质押推荐奖励` |
| Burn | `feat(burn): 实现周期检查与动态销毁` |
| 部署脚本 | `feat(deploy): 添加部署与 Uniswap 加池脚本` |
| 测试 | `test: 补充 staking 边界与集成测试` |
| 前端 | `feat(frontend): 质押与领取最小页面` |
| 演示资料 | `docs: 添加部署地址表与演示说明` |

### Commit 前缀约定（可选但推荐）

- `feat:` 新功能
- `fix:` 修复 bug
- `docs:` 仅文档
- `test:` 测试相关
- `chore:` 构建、配置、杂项
- `refactor:` 重构（不改变行为）

---

## 6. 分支策略（易懂 + 公司常用版）

记一句话：**从 `main` 拉 `feature` 开发，开发完走 PR，再合回 `main`。**

- `main`：正式版 / 稳定版（尽量不要直接在上面日常开发）
- `feature/xxx`：草稿分支（在这里写代码、提交）

### 6.1 标准顺序（推荐）

1. 先切到 `main` 并拉最新
2. 从 `main` 新建 `feature/xxx`
3. 在 `feature/xxx` 上开发并提交
4. 推送 `feature/xxx` 到 GitHub
5. 创建 PR（`feature/xxx` -> `main`）
6. 使用 **Squash and merge** 合并
7. 回到本地更新 `main`，并删除功能分支（可选）

### 6.2 一套可直接照做的命令

```bash
# 1) 切到 main，先同步最新
git checkout main
git pull origin main

# 2) 从 main 拉一条功能分支（示例：staking）
git checkout -b feature/staking

# 3) 开发完成后提交
git add .
git commit -m "feat(staking): 实现质押功能"

# 4) 推送功能分支
git push -u origin feature/staking
```

然后去 GitHub：

1. 打开仓库，点击 `Compare & pull request`
2. 确认方向是 `feature/staking` -> `main`
3. 点击 `Create pull request`
4. 审查通过后点击 **Squash and merge**

合并后本地执行：

```bash
git checkout main
git pull origin main

# 可选：删除本地分支
git branch -d feature/staking
```

### 6.3 什么是 Squash and merge（压缩合并）

假设你的功能分支里有 3 次提交：`F1`、`F2`、`F3`。  
点击 Squash and merge 后，GitHub 会把这 3 次压成 `1` 次提交再进 `main`。

好处：

- `main` 历史更干净（一个 PR 一条提交）
- 回滚更简单（通常回滚那一条 squash 提交）
- 比较适合多人协作和代码审查

---

## 7. 常见问题

### push 被拒绝（远程有更新）

```bash
git pull --rebase origin main
git push
```

### 不小心提交了 `.env`

```bash
# 从 Git 跟踪中移除，但保留本地文件
git rm --cached .env
echo ".env" >> .gitignore
git add .gitignore
git commit -m "chore: 停止跟踪 .env 并加入 gitignore"
git push
```

若 `.env` 里含真实私钥，应在 GitHub 上轮换密钥，并考虑用 `git filter-repo` 清理历史（高级操作，需要时再查）。

### 查看某次提交改了什么

```bash
git show 提交hash
```

### 暂时保存未完成的改动

```bash
git stash
git stash pop
```

---

## 8. 安全检查清单（上传前）

- [ ] `.env`、私钥、助记词已在 `.gitignore` 中
- [ ] `git status` 里没有不该公开的文件
- [ ] commit 信息能看懂「这一步完成了什么」
- [ ] 推送前本地测试通过（至少编译/单测）

---

## 9. 一条命令回顾「今天的工作」

```bash
git log --oneline --since="1 day ago"
```

---

## 10. 参考链接

- [Git 官方文档（中文）](https://git-scm.com/book/zh/v2)
- [GitHub 创建 Personal Access Token](https://github.com/settings/tokens)
- [GitHub 文档：推送现有仓库](https://docs.github.com/en/get-started/importing-your-projects-to-github/importing-source-code-to-github/adding-an-existing-project-to-github-using-the-command-line)
