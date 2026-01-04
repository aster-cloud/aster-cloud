/**
 * 修复策略内容中的无效注释
 *
 * CNL 解析器不支持 // 风格的注释，此脚本会移除策略内容开头的注释行
 *
 * 运行方式：npx tsx scripts/fix-policy-comments.ts
 */

import path from 'node:path';
import dotenv from 'dotenv';

// 加载 .env.local 环境变量
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

import { prisma } from '../src/lib/prisma';

async function main() {
  console.log('查找包含 // 注释的策略...\n');

  // 查找所有内容以 // 开头的策略
  const policies = await prisma.policy.findMany({
    where: {
      content: {
        startsWith: '//',
      },
    },
    select: {
      id: true,
      name: true,
      content: true,
    },
  });

  if (policies.length === 0) {
    console.log('没有找到需要修复的策略。');
    return;
  }

  console.log(`找到 ${policies.length} 个需要修复的策略:\n`);

  for (const policy of policies) {
    console.log(`- ${policy.name} (${policy.id})`);

    // 移除开头的 // 注释行
    const lines = policy.content.split('\n');
    const filteredLines: string[] = [];
    let foundNonComment = false;

    for (const line of lines) {
      const trimmed = line.trim();
      // 跳过开头的注释行和空行
      if (!foundNonComment && (trimmed.startsWith('//') || trimmed === '')) {
        console.log(`  移除: ${trimmed || '(空行)'}`);
        continue;
      }
      foundNonComment = true;
      filteredLines.push(line);
    }

    const newContent = filteredLines.join('\n');

    // 更新策略
    await prisma.policy.update({
      where: { id: policy.id },
      data: { content: newContent },
    });

    console.log(`  ✓ 已修复\n`);
  }

  console.log(`\n完成！共修复 ${policies.length} 个策略。`);
}

main()
  .catch((e) => {
    console.error('错误:', e);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
