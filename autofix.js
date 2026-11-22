const fs = require("fs");
const vm = require("vm");

console.log("🔧 開始讀取並自動修復 app.js...");
let rawCode = fs.readFileSync("./app.js", "utf8");

// 1. 自動修復常見的引號漏寫語法錯誤（如 subtitle": -> "subtitle":）
rawCode = rawCode.replace(/([{,]\s*)([a-zA-Z0-9_]+)":/g, '$1"$2":');

// 2. 切分檔案結構：保留 RADICAL_TRANSFORMS 與 GameData 之後的所有程式碼不動，只重寫 STAGES_DATA
const stagesStartMarker = "const STAGES_DATA = [";
const stagesEndMarker = "// 3. 全 110 階造字查詢與字理輔助引擎";

const startIdx = rawCode.indexOf(stagesStartMarker);
const endIdx = rawCode.indexOf(stagesEndMarker);

if (startIdx === -1 || endIdx === -1) {
  console.error("❌ 找不到 STAGES_DATA 區塊標記，請確認 app.js 結構是否完整。");
  process.exit(1);
}

const headerCode = rawCode.slice(0, startIdx);
const stagesCode = rawCode.slice(startIdx, endIdx);
const footerCode = rawCode.slice(endIdx);

// 3. 在沙盒中解析現有的 STAGES_DATA
const sandbox = {};
vm.createContext(sandbox);
try {
  vm.runInContext(`${stagesCode}\nthis.STAGES = STAGES_DATA;`, sandbox);
} catch (err) {
  console.error("❌ 語法仍有錯誤，請先檢查這行附近：", err.message);
  process.exit(1);
}

const stages = sandbox.STAGES;

// 4. 計算每個基礎部件與合成字最早在哪一階解鎖
const unlockStageMap = new Map();
stages.forEach((st) => {
  st.components.forEach((c) => {
    if (!unlockStageMap.has(c)) unlockStageMap.set(c, st.stage);
  });
});

// 多次迭代推導每個合成字的最早可合成階級
let changed = true;
while (changed) {
  changed = false;
  stages.forEach((st) => {
    st.targets.forEach((t) => {
      t.recipes.forEach((recipe) => {
        if (recipe.every((p) => unlockStageMap.has(p))) {
          const earliest = Math.max(
            st.stage,
            ...recipe.map((p) => unlockStageMap.get(p))
          );
          if (!unlockStageMap.has(t.char) || earliest < unlockStageMap.get(t.char)) {
            unlockStageMap.set(t.char, earliest);
            changed = true;
          }
        }
      });
    });
  });
}

// 5. 整理關卡：去重、修正「街」的結構、並將跨階字搬移到正確階級
const seenChars = new Set();
const newTargetsByStage = new Map();
stages.forEach((st) => newTargetsByStage.set(st.stage, []));

let removedDuplicates = 0;
let movedTargets = 0;
let fixedLayouts = 0;

stages.forEach((st) => {
  st.targets.forEach((t) => {
    // 去除重複字
    if (seenChars.has(t.char)) {
      removedDuplicates++;
      console.log(`  🗑️  移除重複字：第 ${st.stage} 階的「${t.char}」`);
      return;
    }
    seenChars.add(t.char);

    // 修正插槽數量明顯不符的單一配方字（如第 40 階「街」）
    if (t.layout === "tri" && t.recipes.length === 1 && t.recipes[0].length === 2) {
      t.layout = "lr";
      fixedLayouts++;
      console.log(`  📐 修正結構：「${t.char}」從 tri 改為 lr（2 部件）`);
    }

    // 計算該字所有配方中最早可合成的階級
    let validStages = t.recipes
      .filter((r) => r.every((p) => unlockStageMap.has(p)))
      .map((r) => Math.max(...r.map((p) => unlockStageMap.get(p))));

    let targetStage = st.stage;
    if (validStages.length > 0) {
      const earliestPossible = Math.min(...validStages);
      if (earliestPossible > st.stage) {
        targetStage = earliestPossible;
        movedTargets++;
        console.log(`  🚚 搬移跨階字：「${t.char}」從第 ${st.stage} 階 ➔ 移至第 ${targetStage} 階`);
      }
    }

    newTargetsByStage.get(targetStage).push(t);
  });
});

// 6. 將整理後的資料寫回各階級，並確保 unlockThreshold 不會超過該階總字數
stages.forEach((st) => {
  st.targets = newTargetsByStage.get(st.stage);
  if (st.unlockThreshold > st.targets.length) {
    console.log(`  ⚖️  調整第 ${st.stage} 階開箱門檻：${st.unlockThreshold} ➔ ${st.targets.length}`);
    st.unlockThreshold = st.targets.length;
  }
});

// 7. 格式化輸出回 app.js
const formattedStages = stages
  .map((st) => {
    const targetsStr = st.targets
      .map((t) => `      ${JSON.stringify(t).replace(/,"/g, ', "').replace(/:/g, ": ")}`)
      .join(",\n");
    return `  {\n    "stage": ${st.stage},\n    "title": ${JSON.stringify(st.title)},\n    "subtitle": ${JSON.stringify(st.subtitle)},\n    "components": ${JSON.stringify(st.components)},\n    "unlockThreshold": ${st.unlockThreshold},\n    "chestRewardCoins": ${st.chestRewardCoins},\n    "targets": [\n${targetsStr}\n    ]\n  }`;
  })
  .join(",\n");

const finalCode = `${headerCode}const STAGES_DATA = [\n${formattedStages}\n];\n\n${footerCode}`;
fs.writeFileSync("./app.js", finalCode, "utf8");

console.log("\n✅ 自動修復完成！");
console.log(`   - 移除重複字：${removedDuplicates} 個`);
console.log(`   - 搬移跨階字：${movedTargets} 個`);
console.log(`   - 修正結構：${fixedLayouts} 個`);
