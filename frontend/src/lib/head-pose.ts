/**
 * 頭部擺動驅動 (給 LamAvatar 用)
 *
 * gaussian-splat-renderer-for-lam 這個 npm 封裝【沒有】head pose 的輸入通道
 * (對外只有 getExpressionData 拉 52 維表情)。但引擎內部其實有 FLAME skeleton +
 * 'head' bone。所以這裡走「伸手進引擎內部物件」的路:
 *   1. probeHeadBone():從 renderer 實例上盡力挖出名為 'head' 的 three.js Bone
 *   2. applyHeadPose():每一幀把一個 axis-angle [x,y,z] 套到該 bone 的 quaternion
 *
 * 風險:挖的是未文檔化的內部結構,套件升級可能變。挖不到就回 null,呼叫方降級
 * (頭不動,但不報錯)。不 import three —— 直接鴨子型別操作 bone.quaternion
 * (它是 three.Quaternion 實例,有 set/copy/multiplyQuaternions/clone)。
 */

// three.js 物件的最小型別 (只用到的部分),避免 import three 造成版本衝突。
interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
  set(x: number, y: number, z: number, w: number): Quat;
  copy(q: Quat): Quat;
  clone(): Quat;
  multiplyQuaternions(a: Quat, b: Quat): Quat;
}
interface Bone {
  name?: string;
  quaternion: Quat;
  updateMatrixWorld(force?: boolean): void;
}
interface Skeleton {
  bones?: Bone[];
}

export interface HeadBoneHandle {
  bone: Bone;
  initQuat: Quat;
  /** 暫存,避免每幀 new */
  scratch: Quat;
}

/** 在任意物件圖裡廣度優先找含 skeleton.bones 的節點,挖出名為 'head' 的 bone。 */
function findHeadBone(root: unknown, maxNodes = 4000): Bone | null {
  const seen = new Set<unknown>();
  const queue: unknown[] = [root];
  let visited = 0;
  while (queue.length > 0 && visited < maxNodes) {
    const node = queue.shift();
    visited += 1;
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);

    const obj = node as Record<string, unknown>;
    // 直接命中 skeleton.bones
    const skel = (obj.skeleton ?? (obj.flameModel as Record<string, unknown> | undefined)?.skeleton) as
      | Skeleton
      | undefined;
    if (skel?.bones && Array.isArray(skel.bones)) {
      const head = skel.bones.find((b) => b?.name === "head");
      if (head?.quaternion) return head;
    }
    // 往常見的子節點 / 容器展開 (限定字段,避免爆走整個 three 場景)
    for (const key of [
      "scene",
      "splatMesh",
      "flameModel",
      "model",
      "mesh",
      "children",
      "viewer",
      "renderer",
      "_scene",
    ]) {
      const child = obj[key];
      if (Array.isArray(child)) queue.push(...child);
      else if (child && typeof child === "object") queue.push(child);
    }
  }
  return null;
}

/**
 * 從 renderer 實例 (GaussianSplatRenderer.getInstance 回傳值) 盡力挖出 head bone。
 * 挖不到回 null。renderer 可能有 getScene()/scene 等入口,都試。
 */
export function probeHeadBone(renderer: unknown): HeadBoneHandle | null {
  if (!renderer || typeof renderer !== "object") return null;
  const r = renderer as Record<string, unknown>;

  const roots: unknown[] = [renderer];
  // 常見的場景取得方式
  for (const getter of ["getScene", "getViewer"]) {
    const fn = r[getter];
    if (typeof fn === "function") {
      try {
        roots.push((fn as () => unknown).call(renderer));
      } catch {
        /* ignore */
      }
    }
  }
  for (const key of ["scene", "viewer", "splatMesh", "model"]) {
    if (r[key]) roots.push(r[key]);
  }

  for (const root of roots) {
    const bone = findHeadBone(root);
    if (bone) {
      return { bone, initQuat: bone.quaternion.clone(), scratch: bone.quaternion.clone() };
    }
  }
  return null;
}

/**
 * 把 axis-angle [x,y,z] (向量方向=軸,長度=角度,弧度) 套到 head bone。
 * 等同 chat.html 的 applyHeadPose:bone.q = initQuat * deltaQuat。
 */
export function applyHeadPose(handle: HeadBoneHandle, pose: [number, number, number]): void {
  const [x, y, z] = pose;
  const len = Math.hypot(x, y, z);
  const { bone, initQuat, scratch } = handle;
  if (len < 1e-6) {
    bone.quaternion.copy(initQuat);
  } else {
    // axis-angle → quaternion:q = (axis * sin(θ/2), cos(θ/2)),axis 已正規化
    const half = len / 2;
    const s = Math.sin(half) / len; // (sin(half) / len) * component = sin(half)*axisComponent
    scratch.set(x * s, y * s, z * s, Math.cos(half));
    bone.quaternion.multiplyQuaternions(initQuat, scratch);
  }
  bone.updateMatrixWorld(true);
}
