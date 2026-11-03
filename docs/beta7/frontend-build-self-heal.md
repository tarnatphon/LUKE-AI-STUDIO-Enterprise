# Frontend build self-heal — ไม่ให้ `git pull` ทิ้ง UI เก่าไว้

> ปัญหาที่เจอบน `/Volumes/AI`: pull ถึง `b926481` แล้ว แต่ `app/dist` ยังเป็น `ace084f`
> แอปพิมพ์ `Running!` และ `/api/health` บอก `stale: False` (เพราะเก่าด้วยกันทั้งคู่)
> จนต้องตามหา `.git/index.lock` / `npm install` / `npx vite build` กันหลายรอบ

## ช่องว่างเดิม

| ชั้น | ก่อนแก้ |
| :--- | :--- |
| `vite.config.js` | ฝัง `git rev-parse HEAD` ลง `app/dist/build-info.json` อยู่แล้ว (deterministic ไม่มี wall-clock → build ซ้ำที่ commit เดียวกันได้ไฟล์เหมือนกันเป๊ะ) |
| `serve.cjs:5254` | คำนวณ `frontend.stale = build.commit !== source.commit` **อยู่แล้ว** โชว์ใน `/api/health` + sidebar |
| `mac.sh` | มี self-heal แต่เช็คแค่ **ไฟล์ asset ครบมั้ย** จาก `.vite/manifest.json` **ไม่เช็ค commit** และรัน `npm run build` แบบ `>/dev/null 2>&1` **ก่อน** deps guard → ถ้า `node_modules` พังจะล้มเหลวเงียบๆ |
| `linux.sh` | **ไม่มี** dist self-heal เลย |

ผล: ไม่มีใครเอาค่า `stale` ไปทำอะไร ผู้ใช้ต้องจำคำสั่ง `npx vite build` เองทุกครั้งหลัง pull

## สิ่งที่เพิ่ม

**helper กลาง `scripts/setup/check-frontend-build.sh`** — `mac.sh` และ `linux.sh` เรียก **หลัง deps guard และหลัง first-time setup** (ลำดับนี้สำคัญมาก: จะได้ไม่มีทาง rebuild บน `node_modules` ที่พัง เพราะ guard จาก PR #84/#85 หยุดไว้ก่อนแล้ว)

1. ถ้าไม่มี git / `rev-parse HEAD` ไม่ได้ → **ข้ามเงียบๆ `exit 0`** (zip, exported source, offline-first ไม่ถูกบล็อก)
2. อ่าน `commit` จาก `app/dist/build-info.json` แล้วเทียบกับ `HEAD`
3. rebuild ถ้า: commit ต่าง / ไม่มี `build-info.json` / ไม่มี stamp / ไม่มี `index.html` / ไม่มี manifest / **asset ที่ manifest ระบุหายไป**
4. **ก่อน build**: ตรวจ `node_modules/vite/package.json` + `vite/bin/vite.js` อีกชั้น (กัน `ERR_MODULE_NOT_FOUND` แบบ cryptic)
5. ใช้ portable npm ของเครื่อง (`$NODE_BIN "$NPM_CLI" run build`) ถ้ามี ไม่งั้น fallback ไป `npm run build` — เพราะ launcher เพิ่ง `export PATH` ตอนจะสตาร์ทเซิร์ฟเวอร์ ซึ่งอยู่ **หลัง** จุดนี้
6. **หลัง build ตรวจซ้ำ** ว่า stamp ตรง `HEAD` และ `index.html` มีจริง — ถ้า build exit 0 แต่ทิ้ง stamp ผิด → `exit 1`
7. ถ้า rebuild ล้มเหลว → พิมพ์คำสั่งซ่อม (`npm ci` / `npm run build` / `./mac.sh`) แล้ว **`exit 1` แทนการเสิร์ฟ UI เก่า**
8. ถ้า bundle ตรงอยู่แล้ว → พิมพ์ `Frontend bundle matches <short>.` แล้วไม่ทำอะไร (ไม่เสียเวลา build ทุก launch)

self-heal เก่าของ `mac.sh` ถูกลบออก (ย้ายตรรกะ asset completeness มาไว้ใน helper) — ไม่เหลือ `npm run build` ที่กลืน error อีกต่อไป

## ผลต่อการใช้งานบน Mac

**หลัง `git pull` ไม่ต้อง `npx vite build` เองอีกแล้ว** — แค่ `./mac.sh` มันจะเห็น commit เปลี่ยนแล้ว build ให้ (~1–4 วินาที) แล้วค่อยเปิดแอป

```bash
cd /Volumes/AI
git fetch origin && git checkout main && git pull --ff-only
./mac.sh                      # [dist] bundle was built from <เก่า>, checkout is <ใหม่> — rebuilding...
```

เช็คเหมือนเดิม:
```bash
curl -sS http://127.0.0.1:1420/api/health | python3 -c "
import json,sys
d=json.load(sys.stdin); s=d.get('source',{}); f=d.get('frontend',{})
print(s.get('shortCommit'), f.get('shortCommit'), f.get('stale'))
"
```
ต้องได้ commit เดียวกัน + `False`

> ถ้าเจอ `[ERROR] Frontend bundle check failed` → อ่านข้อความที่ helper พิมพ์ (บอกสาเหตุ + คำสั่งซ่อม) อย่ากดข้าม — แอปตั้งใจไม่เสิร์ฟ UI เก่า

## หลักฐาน

`node scripts/validation/test-frontend-build-self-heal.cjs` — **32 checks**

- static: helper + ทั้ง 2 launcher `bash -n` ผ่าน, ลำดับ **deps guard → setup.sh → helper** ถูกต้องในทั้งสองไฟล์, self-heal เก่าถูกลบ, helper ตรวจ vite ก่อน build / ตรวจ stamp หลัง build / ไม่มี wall-clock (รักษากฎ byte-identical ของ `test-frontend-dist-freshness.cjs`)
- **รัน helper จริง** ใน throwaway repo พร้อม stub `git` / `npm` ครบ 15 กรณี: stamp ตรง (ไม่ rebuild), asset หาย (rebuild ทั้งที่ stamp ตรง), commit ต่าง, ไม่มี `build-info.json`, ไม่มี stamp, ไม่มี manifest, ไม่มี `index.html`, ไม่มี dist เลย, **ไม่มี `.git`** → ข้ามเงียบ, **ไม่มี git binary** → ข้ามเงียบ, vite หาย → `exit 1` **ก่อน** เรียก npm, build fail → `exit 1` พร้อมคำสั่งซ่อม, build exit 0 แต่ stamp ผิด → `exit 1`, bundle ตรงแต่ vite หาย → ผ่าน (ไม่ต้อง build)
- `node scripts/validation/run-all.cjs --include-python --timeout 300 --no-report` → ผ่านครบ, `npx vite build`, eslint, API contracts, bundle budgets, `test-mac-launch-files-tracked.cjs` (helper มาจาก git จริง) ผ่าน

เอกสารที่เกี่ยวข้อง: [`mac-launcher-deps-guard.md`](mac-launcher-deps-guard.md) (guard ที่คุม `node_modules` อยู่ก่อนหน้า helper นี้)
