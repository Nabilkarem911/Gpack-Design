const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:localtest@127.0.0.1:55432/gpack_portal';

async function seedDemo() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const cRes = await pool.query(`
      INSERT INTO clients (name, email, phone)
      VALUES ('شركة الأفق للتجارة', 'alofooq@demo.sa', '0551234567')
      RETURNING id, name
    `);
    const client = cRes.rows[0];

    let designer;
    const dCheck = await pool.query(`SELECT id, name FROM users WHERE role = 'DESIGNER' LIMIT 1`);
    if (dCheck.rowCount) {
      designer = dCheck.rows[0];
    } else {
      const dRes = await pool.query(`
        INSERT INTO users (name, email, role, password_hash)
        VALUES ('أحمد المصمم', 'designer@gpack.sa', 'DESIGNER', 'dummy')
        RETURNING id, name
      `);
      designer = dRes.rows[0];
    }

    const pRes = await pool.query(`
      INSERT INTO projects (name, client_id, designer_id, status, brief)
      VALUES ('تصميم هوية وعلب تغليف فاخرة', $1, $2, 'WAITING_FOR_CLIENT', 'تصميم علب كرتونية فاخرة بلمسات ذهبية وشعار أنيق مع خيارات ألوان متعددة.')
      RETURNING id, name
    `, [client.id, designer.id]);
    const project = pRes.rows[0];

    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    function makeColorPng(r, g, b) {
      const png = new PNG({ width: 600, height: 400 });
      for (let y = 0; y < 400; y++) {
        for (let x = 0; x < 600; x++) {
          const idx = (600 * y + x) << 2;
          png.data[idx] = r;
          png.data[idx + 1] = g;
          png.data[idx + 2] = b;
          png.data[idx + 3] = 255;
        }
      }
      return PNG.sync.write(png);
    }

    const pngA = makeColorPng(90, 61, 99);
    const pngB = makeColorPng(245, 185, 20);
    const pngC = makeColorPng(40, 140, 110);

    const fileAName = 'demo_opt_a_' + Date.now() + '.png';
    const fileBName = 'demo_opt_b_' + Date.now() + '.png';
    const fileCName = 'demo_opt_c_' + Date.now() + '.png';

    fs.writeFileSync(path.join(uploadsDir, fileAName), pngA);
    fs.writeFileSync(path.join(uploadsDir, fileBName), pngB);
    fs.writeFileSync(path.join(uploadsDir, fileCName), pngC);

    const vRes = await pool.query(`
      INSERT INTO versions (project_id, number, status, notes)
      VALUES ($1, 8, 'PENDING', 'تم تجهيز ثلاثة خيارات للهوية والتغليف بناءً على مناقشاتنا الأخيرة.')
      RETURNING id
    `, [project.id]);
    const versionId = vRes.rows[0].id;

    const optARes = await pool.query(`INSERT INTO design_options (version_id, name, status) VALUES ($1, 'A', 'PROPOSED') RETURNING id`, [versionId]);
    const optBRes = await pool.query(`INSERT INTO design_options (version_id, name, status) VALUES ($1, 'B', 'SELECTED') RETURNING id`, [versionId]);
    const optCRes = await pool.query(`INSERT INTO design_options (version_id, name, status) VALUES ($1, 'C', 'PROPOSED') RETURNING id`, [versionId]);

    await pool.query(`
      INSERT INTO files (project_id, uploaded_by_type, uploaded_by_id, original_name, stored_name, mime, size, version_id, option_id)
      VALUES 
      ($1, 'DESIGNER', $2, 'Box-Design-Option-A.png', $3, 'image/png', $4, $5, $6),
      ($1, 'DESIGNER', $2, 'Box-Design-Option-B.png', $7, 'image/png', $8, $5, $9),
      ($1, 'DESIGNER', $2, 'Box-Design-Option-C.png', $10, 'image/png', $11, $5, $12)
    `, [
      project.id, designer.id,
      fileAName, pngA.length, versionId, optARes.rows[0].id,
      fileBName, pngB.length, optBRes.rows[0].id,
      fileCName, pngC.length, optCRes.rows[0].id
    ]);

    await pool.query(`
      INSERT INTO messages (project_id, sender_type, sender_id, body, type)
      VALUES 
      ($1, 'DESIGNER', $2, 'مرحباً بكم! تم رفع تصاميم الإصدار V8 مع 3 خيارات مختلفة (A و B و C). يرجى الاطلاع واختيار الخيار الأنسب لكم للمراجعة أو الاعتماد.', 'TEXT'),
      ($1, 'CLIENT', $3, 'أهلاً بك، سنقوم بمراجعة الخيارات الآن وموافاتكم بالملاحظات.', 'TEXT')
    `, [project.id, designer.id, client.id]);

    const rawCode = 'DEMO' + Math.floor(100000 + Math.random() * 900000);
    const codeHash = crypto.createHash('sha256').update(rawCode.toUpperCase()).digest('hex');
    await pool.query(`
      INSERT INTO portal_access (client_id, project_id, code_hash, revoked)
      VALUES ($1, $2, $3, false)
    `, [client.id, project.id, codeHash]);

    console.log('Project ID:', project.id);
    console.log('Portal Link:', 'http://localhost:3000/c/' + rawCode);
  } finally {
    await pool.end();
  }
}

seedDemo().catch(console.error);
