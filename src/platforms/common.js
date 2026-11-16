/** Tiện ích dùng chung cho các nền tảng. Mọi thao tác đều duyệt qua tất cả frame (Zoom web client hay nằm trong iframe). */

export async function framesText(page, selector = 'body') {
  const parts = [];
  for (const frame of page.frames()) {
    try {
      const t = await frame.evaluate((sel) => {
        const nodes = sel === 'body' ? [document.body] : Array.from(document.querySelectorAll(sel));
        return nodes.map((n) => (n && n.innerText) || '').join('\n');
      }, selector);
      if (t) parts.push(t);
    } catch {
      /* frame đang điều hướng */
    }
  }
  return parts.join('\n');
}

function locate(frame, spec) {
  if (typeof spec === 'string') return frame.locator(spec);
  return frame.getByRole(spec.role || 'button', { name: spec.name });
}

/** Trả về true nếu có ít nhất một phần tử khớp đang hiển thị. */
export async function anyVisible(page, specs) {
  for (const frame of page.frames()) {
    for (const spec of specs) {
      try {
        if (await locate(frame, spec).first().isVisible()) return true;
      } catch {
        /* bỏ qua */
      }
    }
  }
  return false;
}

/** Bấm phần tử khớp đầu tiên đang hiển thị. Không ném lỗi. */
export async function tryClick(page, specs, { timeout = 1500 } = {}) {
  for (const frame of page.frames()) {
    for (const spec of specs) {
      try {
        const el = locate(frame, spec).first();
        if (await el.isVisible()) {
          await el.click({ timeout });
          return true;
        }
      } catch {
        /* thử ứng viên tiếp theo */
      }
    }
  }
  return false;
}

/** Điền giá trị vào ô nhập khớp đầu tiên đang hiển thị (chỉ khi ô đang khác giá trị cần điền). */
export async function tryFill(page, selectors, value) {
  for (const frame of page.frames()) {
    for (const sel of selectors) {
      try {
        const el = frame.locator(sel).first();
        if (await el.isVisible()) {
          const cur = await el.inputValue().catch(() => '');
          if (cur !== value) await el.fill(value, { timeout: 1500 });
          return true;
        }
      } catch {
        /* thử ứng viên tiếp theo */
      }
    }
  }
  return false;
}

/**
 * Các trạng thái chuẩn mà mỗi nền tảng trả về từ detect():
 *  prejoin       — đang ở màn hình nhập tên / nút Join
 *  not_started   — phòng chưa mở (host chưa bắt đầu, chưa có ai...)
 *  waiting_room  — đã xin vào, đang chờ được duyệt
 *  in_meeting    — đang ở trong phòng
 *  ended         — phòng đã đóng / bị mời ra
 *  denied        — bị từ chối vào
 *  needs_login   — phòng yêu cầu đăng nhập tài khoản
 *  bot_blocked   — phòng chặn bot tự động (chặn có chủ đích của người tổ chức; bot dừng, không vượt qua)
 *  invalid       — link sai / không tồn tại
 *  unknown       — chưa nhận diện được
 */
export const STATES = ['prejoin', 'not_started', 'waiting_room', 'in_meeting', 'ended', 'denied', 'needs_login', 'bot_blocked', 'invalid', 'unknown'];
