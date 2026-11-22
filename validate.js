const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

// 1. 讀取 app.js 並截取到 GameData 結束為止（避開瀏覽器 DOM 操作）
const rawCode = fs.readFileSync("./app.js", "utf8");
const dataOnlyCode = rawCode.split("const GAS_API_URL")[0];

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  `${dataOnlyCode}\nthis.EXPORTED = { RADICAL_TRANSFORMS, STAGES_DATA, GameData };`,
  sandbox
);

const { RADICAL_TRANSFORMS, STAGES_DATA, GameData } = sandbox.EXPORTED;
const errors = [];
const warnings = [];

console.log(`🔍 開始驗證《墨韻活字工坊》資料庫（共 ${STAGES_DATA.length} 階）...\n`);

// 規則定義：每種結構允許的部件數量
const EXPECTED_SLOT_COUNTS = {
  lr: [2],
  tb: [2],
  enc: [2],
  tri: [3],
  quad: [4]
};

const allTargetMap = new Map(); // char -> stage
const availablePool = new Set(); // 模擬玩家從第 1 階到第 110 階累積擁有的所有部件與字

STAGES_DATA.forEach((st, idx) => {
  const stageNum = st.stage;
  if (stageNum !== idx + 1) {
    errors.push(`[階級編號異常] 預期第 ${idx + 1} 階，實際為 ${stageNum}`);
  }

  // 將本階新增的基礎活字加入可用池
  st.components.forEach((c) => availablePool.add(c));

  let craftableInThisStage = 0;

  st.targets.forEach((t) => {
    // 檢查重複目標字
    if (allTargetMap.has(t.char)) {
      warnings.push(`[重複字] 「${t.char}」同時出現在第 ${allTargetMap.get(t.char)} 階與第 ${stageNum} 階`);
    } else {
      allTargetMap.set(t.char, stageNum);
    }

    // 檢查結構與配方部件數量是否一致
    const allowedCounts = EXPECTED_SLOT_COUNTS[t.layout];
    if (!allowedCounts) {
      errors.push(`[第 ${stageNum} 階 - ${t.char}] 未知的 layout 類型: "${t.layout}"`);
    }

    let hasValidRecipeAtCurrentStage = false;

    t.recipes.forEach((recipe) => {
      if (allowedCounts && !allowedCounts.includes(recipe.length)) {
        errors.push(
          `[第 ${stageNum} 階 - ${t.char}] 結構 "${t.layout}" 需要 ${allowedCounts} 個部件，但配方 [${recipe.join(", ")}] 有 ${recipe.length} 個（會導致無法合成！）`
        );
      }

      // 檢查配方中的每個部件，在目前階級是否已經取得
      const missing = recipe.filter((part) => !availablePool.has(part));
      if (missing.length === 0) {
        hasValidRecipeAtCurrentStage = true;
      } else {
        warnings.push(
          `[第 ${stageNum} 階 - ${t.char}] 配方 [${recipe.join(" + ")}] 缺少前置部件：${missing.join(", ")}`
        );
      }
    });

    if (hasValidRecipeAtCurrentStage) {
      craftableInThisStage++;
      availablePool.add(t.char); // 合成後加入可用池，供後續配方使用
    }
  });

  // 檢查本階可合成字數是否足以開啟傳承寶箱（防死鎖）
  if (craftableInThisStage < st.unlockThreshold) {
    errors.push(
      `[死鎖警告！第 ${stageNum} 階] 開箱門檻需 ${st.unlockThreshold} 字，但依現有前置部件最多只能合成 ${craftableInThisStage} 字！`
    );
  }
});

// 檢查雙子星 (twin) 雙向關聯是否完整
STAGES_DATA.forEach((st) => {
  st.targets.forEach((t) => {
    if (t.twin && !allTargetMap.has(t.twin)) {
      errors.push(`[第 ${st.stage} 階 - ${t.char}] 設定的雙子星 twin "${t.twin}" 不存在於任何關卡中`);
    }
  });
});

// 輸出體檢報告
console.log(`⚠️  警告數量 (跨階部件/重複字): ${warnings.length}`);
warnings.slice(0, 15).forEach((w) => console.log("  " + w));
if (warnings.length > 15) console.log(`  ... 以及其他 ${warnings.length - 15} 則警告\n`);

console.log(`\n❌ 嚴重錯誤數量 (會導致卡關或無法合成): ${errors.length}`);
errors.forEach((e) => console.error("  " + e));

if (errors.length > 0) {
  process.exit(1); // 讓 CI/CD 測試失敗並阻擋合併
} else {
  console.log("\n✅ 恭喜！所有 110 階關卡皆通過可達性與結構完整性驗證！");
}
