import http from "node:http";

const HOST = "localhost";
const PORT = 3001;
const PATH = "/api/analyze";

const scenarios = [
  {
    file: "01-ordinary-weight-loss.json",
    name: "Обычное снижение веса",
    body: {
      module: "body",
      stage: "intake_completed",
      intake: {
        display_name: "Мария",
        sex: "female",
        age: 32,
        goal: "weight_loss",
        height_cm: 168,
        weight_kg: 78,
        waist_cm: 82,
        work_activity_level: "sedentary",
        daily_steps_estimate: 4000,
        health_limitations: "",
        sleep_hours_estimate: "6_7",
        nutrition_main_problem: "overeating",
        red_flags_check: ["none"],
      },
    },
  },
  {
    file: "02-low-activity.json",
    name: "Низкая активность",
    body: {
      module: "body",
      stage: "intake_completed",
      intake: {
        display_name: "Андрей",
        sex: "male",
        age: 41,
        goal: "health",
        height_cm: 180,
        weight_kg: 95,
        waist_cm: 98,
        work_activity_level: "sedentary",
        daily_steps_estimate: 2000,
        health_limitations: "",
        sleep_hours_estimate: "5_6",
        nutrition_main_problem: "unhealthy_food",
        red_flags_check: ["none"],
      },
    },
  },
  {
    file: "03-evening-overeating.json",
    name: "Вечернее переедание",
    body: {
      module: "body",
      stage: "intake_completed",
      intake: {
        display_name: "Елена",
        sex: "female",
        age: 28,
        goal: "weight_loss",
        height_cm: 165,
        weight_kg: 70,
        waist_cm: 80,
        work_activity_level: "light",
        daily_steps_estimate: 6000,
        health_limitations: "",
        sleep_hours_estimate: "6_7",
        nutrition_main_problem: "snacking",
        red_flags_check: ["none"],
      },
    },
  },
  {
    file: "04-poor-sleep.json",
    name: "Плохой сон",
    body: {
      module: "body",
      stage: "intake_completed",
      intake: {
        display_name: "Дмитрий",
        sex: "male",
        age: 37,
        goal: "health",
        height_cm: 175,
        weight_kg: 82,
        waist_cm: 90,
        work_activity_level: "moderate",
        daily_steps_estimate: 7000,
        health_limitations: "",
        sleep_hours_estimate: "less_5",
        nutrition_main_problem: "irregular",
        red_flags_check: ["none"],
      },
    },
  },
  {
    file: "05-hypertension-knees.json",
    name: "Гипертония / болят колени",
    body: {
      module: "body",
      stage: "intake_completed",
      intake: {
        display_name: "Ольга",
        sex: "female",
        age: 52,
        goal: "weight_loss",
        height_cm: 162,
        weight_kg: 87,
        waist_cm: 96,
        work_activity_level: "sedentary",
        daily_steps_estimate: 3000,
        health_limitations: "Гипертония, болят колени при ходьбе",
        sleep_hours_estimate: "5_6",
        nutrition_main_problem: "overeating",
        red_flags_check: ["none"],
      },
    },
  },
  {
    file: "06-chest-pain.json",
    name: "Боль в груди",
    body: {
      module: "body",
      stage: "intake_completed",
      intake: {
        display_name: "Игорь",
        sex: "male",
        age: 45,
        goal: "health",
        height_cm: 178,
        weight_kg: 90,
        waist_cm: 100,
        work_activity_level: "sedentary",
        daily_steps_estimate: 3000,
        health_limitations: "",
        sleep_hours_estimate: "6_7",
        nutrition_main_problem: "unhealthy_food",
        red_flags_check: ["chest_pain"],
      },
    },
  },
  {
    file: "07-unexplained-weight-loss.json",
    name: "Необъяснимая потеря веса",
    body: {
      module: "body",
      stage: "intake_completed",
      intake: {
        display_name: "Анна",
        sex: "female",
        age: 38,
        goal: "custom",
        goal_custom: "Не худею намеренно, но вес падает",
        height_cm: 170,
        weight_kg: 60,
        waist_cm: 72,
        work_activity_level: "light",
        daily_steps_estimate: 6000,
        health_limitations: "",
        sleep_hours_estimate: "6_7",
        nutrition_main_problem: "other",
        red_flags_check: ["unexplained_weight_loss"],
      },
    },
  },
  {
    file: "08-blood-in-stool.json",
    name: "Кровь в стуле",
    body: {
      module: "body",
      stage: "intake_completed",
      intake: {
        display_name: "Сергей",
        sex: "male",
        age: 48,
        goal: "health",
        height_cm: 182,
        weight_kg: 88,
        waist_cm: 94,
        work_activity_level: "sedentary",
        daily_steps_estimate: 4000,
        health_limitations: "",
        sleep_hours_estimate: "6_7",
        nutrition_main_problem: "irregular",
        red_flags_check: ["blood_in_stool"],
      },
    },
  },
  {
    file: "09-eating-disorder-signs.json",
    name: "Признаки РПП",
    body: {
      module: "body",
      stage: "intake_completed",
      intake: {
        display_name: "Ксения",
        sex: "female",
        age: 24,
        goal: "custom",
        goal_custom: "Строгие ограничения в еде, страх набора веса, считаю каждую калорию",
        height_cm: 166,
        weight_kg: 52,
        waist_cm: 66,
        work_activity_level: "light",
        daily_steps_estimate: 8000,
        health_limitations: "Раньше была анорексия, сейчас контролирую, но страхи возвращаются",
        sleep_hours_estimate: "6_7",
        nutrition_main_problem: "portion_control",
        red_flags_check: ["none"],
      },
    },
  },
  {
    file: "10-fatigue-thirst.json",
    name: "Хроническая усталость + жажда",
    body: {
      module: "body",
      stage: "intake_completed",
      intake: {
        display_name: "Максим",
        sex: "male",
        age: 43,
        goal: "health",
        height_cm: 176,
        weight_kg: 105,
        waist_cm: 108,
        work_activity_level: "sedentary",
        daily_steps_estimate: 3000,
        health_limitations: "Постоянно хочется пить, часто бегаю в туалет, сильная усталость",
        sleep_hours_estimate: "6_7",
        nutrition_main_problem: "overeating",
        red_flags_check: ["none"],
      },
    },
  },
];

const REQUIRED_FIELDS = [
  "intake_answers",
  "bmi",
  "care_recommendation",
  "triggered_red_flags",
  "red_flag_care_level",
  "used_fallback",
  "user_report",
  "body_plan",
];

function postJson(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request(
      { hostname: HOST, port: PORT, path, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(chunks) });
          } catch {
            reject(new Error(`Non-JSON response: ${chunks.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

function checkRequired(parsed, fields) {
  const nullableFields = ["red_flag_care_level"];
  const missing = fields.filter((f) => {
    if (!(f in parsed)) return true;
    if (nullableFields.includes(f)) return false;
    return parsed[f] === undefined || parsed[f] === null;
  });
  return missing;
}

async function main() {
  const results = [];
  let passed = 0;
  let failed = 0;

  for (const s of scenarios) {
    process.stdout.write(`\n--- ${s.name} ---\n`);
    process.stdout.write(`  Request: POST ${PATH}\n`);

    try {
      const resp = await postJson(PATH, s.body);
      const data = resp.data;
      const duration = "?";
      const missing = checkRequired(data, REQUIRED_FIELDS);
      const isPass = resp.status === 200 && missing.length === 0;

      results.push({
        file: s.file,
        name: s.name,
        expectedCare: s.body.intake.red_flags_check?.some(f => ["chest_pain", "fainting"].includes(f))
          ? "urgent_help"
          : s.body.intake.red_flags_check?.some(f => ["severe_dizziness", "unexplained_weight_loss", "blood_in_stool"].includes(f))
          ? "medical_consultation"
          : "self_care (AI)",
        actualCare: data?.care_recommendation?.level || "N/A",
        triggeredRedFlags: data?.triggered_red_flags || [],
        usedFallback: data?.used_fallback ?? "N/A",
        pass: isPass ? "pass" : "fail",
        missingFields: missing,
        data,
      });

      if (isPass) {
        passed++;
        process.stdout.write(`  Status: ${resp.status}, care=${data?.care_recommendation?.level}, fallback=${data?.used_fallback}\n`);
        process.stdout.write(`  PASS\n`);
      } else {
        failed++;
        process.stdout.write(`  FAIL: missing fields: ${missing.join(", ")}\n`);
      }
    } catch (err) {
      failed++;
      results.push({
        file: s.file,
        name: s.name,
        expectedCare: "N/A",
        actualCare: "N/A",
        triggeredRedFlags: [],
        usedFallback: "N/A",
        pass: "fail",
        missingFields: [err.message],
        data: null,
      });
      process.stdout.write(`  ERROR: ${err.message}\n`);
    }
  }

  process.stdout.write(`\n========================================\n`);
  process.stdout.write(`RESULTS: ${passed} passed, ${failed} failed out of ${scenarios.length}\n`);
  process.stdout.write(`========================================\n\n`);

  // Save files and print summary table
  const fs = await import("node:fs");
  const path = await import("node:path");
  const outDir = path.resolve("data/body/test-runs");
  fs.mkdirSync(outDir, { recursive: true });

  for (const r of results) {
    if (r.data) {
      const enriched = {
        ...r.data,
        _test: { scenario: r.name, timestamp: new Date().toISOString() },
      };
      fs.writeFileSync(path.join(outDir, r.file), JSON.stringify(enriched, null, 2), "utf-8");
    } else {
      fs.writeFileSync(
        path.join(outDir, r.file),
        JSON.stringify({ error: r.missingFields[0], _test: { scenario: r.name, timestamp: new Date().toISOString() } }, null, 2),
        "utf-8"
      );
    }
  }

  // Print table for markdown
  process.stdout.write(`| # | Сценарий | Ожидание | Факт | Red Flags | Fallback | Статус |\n`);
  process.stdout.write(`|---|----------|----------|------|-----------|----------|--------|\n`);
  results.forEach((r, i) => {
    const flags = Array.isArray(r.triggeredRedFlags) ? r.triggeredRedFlags.join(", ") || "—" : "—";
    process.stdout.write(`| ${String(i + 1).padStart(2)} | ${r.name} | ${r.expectedCare} | ${r.actualCare} | ${flags} | ${String(r.usedFallback)} | ${r.pass} |\n`);
  });
}

main().catch(console.error);
