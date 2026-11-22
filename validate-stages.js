// scripts/validate-stages.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appPath = path.resolve(__dirname, '../app.js');
const code = fs.readFileSync(appPath, 'utf-8');

// 1. 擷取並執行 STAGES_DATA 區塊（確保語法合法）
const match = code.match(/const\s+STAGES_DATA\s*=\s*(\[[\s\S]*?\]);/);
if (!match) {
  console.error('❌ [FATAL] 無法在 app.js 中找到 STAGES_DATA');
  process.exit(1);
}

let STAGES_DATA;
try {
  STAGES_DATA = vm.runInNewContext(`(${match[1]})`);
} catch (err) {
  console.error('❌ [FATAL] STAGES_DATA 語法解析失敗：', err.message);
  process.exit(1);
}

const VALID_LAYOUTS = new Set(['lr', 'tb', 'enc', 'tri', 'quad']);
const errors = [];
const warnings = [];

const allComponents = new Set();
const allTargets = new Set();
const compFirstStage = new Map();
const targetFirstStage = new Map();

// 預先建立全域字庫索引
for (const st of STAGES_DATA) {
  for (const c of st.components) {
    allComponents.add(c);
    if (!compFirstStage.has(c)) compFirstStage.set(c, st.stage);
  }
  for (const t of st.targets) {
    allTargets.add(t.char);
    if (!targetFirstStage.has(t.char)) targetFirstStage.set(t.char, st.stage);
  }
}

// 逐階檢核
for (const st of STAGES_DATA) {
  const s = st.stage;
  const stageCompSet = new Set(st.components);
  const stageTargetSet = new Set();

  // 檢查同階 components 重複
  if (stageCompSet.size !== st.components.length) {
    errors.push(`第 ${s} 階〈${st.title}〉：components 陣列內部有重複元件`);
  }

  for (const c of st.components) {
    // 檢查是否前面已發放過相同元件
    if (compFirstStage.get(c) < s) {
      warnings.push(`第 ${s} 階〈${st.title}〉：元件「${c}」早在第 ${compFirstStage.get(c)} 階已發放過`);
    }
    // 檢查是否前面已可透過配方合成
    if (targetFirstStage.has(c) && targetFirstStage.get(c) < s) {
      warnings.push(`第 ${s} 階〈${st.title}〉：元件「${c}」早在第 ${targetFirstStage.get(c)} 階就已可合成`);
    }
  }

  for (const t of st.targets) {
    // 檢查同階重複目標字
    if (stageTargetSet.has(t.char)) {
      errors.push(`第 ${s} 階〈${st.title}〉：目標字「${t.char}」在同一階重複出現`);
    }
    stageTargetSet.add(t.char);

    // 檢查同階 components 直接白送目標字
    if (stageCompSet.has(t.char)) {
      errors.push(`第 ${s} 階〈${st.title}〉：目標字「${t.char}」同時出現在本階 components 中（無需合成即擁有）`);
    }

    // 檢查結構代號
    if (!VALID_LAYOUTS.has(t.layout)) {
      errors.push(`第 ${s} 階〈${st.title}〉：目標字「${t.char}」使用了無效結構 "${t.layout}"`);
    }

    // 檢查配方原料是否存在於全遊戲字庫
    if (!Array.isArray(t.recipes) || t.recipes.length === 0) {
      errors.push(`第 ${s} 階〈${st.title}〉：目標字「${t.char}」缺少 recipes`);
    } else {
      for (const rec of t.recipes) {
        for (const part of rec) {
          if (!allComponents.has(part) && !allTargets.has(part)) {
            errors.push(`第 ${s} 階〈${st.title}〉：目標字「${t.char}」的配方 [${rec.join(' + ')}] 需要「${part}」，但全遊戲從未提供或可合成此字！`);
          }
        }
      }
    }
  }
}

console.log(`🔍 已掃描 ${STAGES_DATA.length} 個關卡（${allComponents.size} 個基礎元件，${allTargets.size} 個目標字）`);

if (warnings.length > 0) {
  console.log(`\n⚠️  發現 ${warnings.length} 項提醒（Warning）：`);
  warnings.forEach(w => console.log(`   - ${w}`));
}

if (errors.length > 0) {
  console.error(`\n❌ 發現 ${errors.length} 項嚴重錯誤（Error），已阻擋 Push：`);
  errors.forEach(e => console.error(`   - ${e}`));
  process.exit(1);
}

console.log('\n✅ 關卡資料檢查通過！');
