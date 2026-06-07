import type {
  Artifact,
  Assets,
  AvatarConfig,
  Consent,
  DeceasedInfo,
  DescendantSnapshot,
  ERC721Attribute,
  MemorialTheme,
  Story,
  TabletMetadata,
} from "../../shared/types/tablet.js";

export interface TabletMetadataInput {
  deceased: DeceasedInfo;
  /** ERC-6150 depth (root = 0). */
  generation?: number;
  /** Portrait URI used for ERC-721 `image`. Falls back to `assets.portrait`. */
  image?: string;
  /** Override description; otherwise auto-generated from biography / birth-death. */
  description?: string;
  external_url?: string;
  descendants?: DescendantSnapshot[];
  assets?: Assets;
  artifact?: Artifact;
  consent?: Consent;
  /** Talking-head / cloned-voice config (kept in lock-step with frontend builder). */
  avatar?: AvatarConfig;
  /** 哀悼版回憶的上鏈快照 (屋主策展)。 */
  stories?: Story[];
  /** 追悼頁背景主題 id。 */
  background?: MemorialTheme;
  /** 是否公開列出。false 也有意義,故 spread 用 !== undefined。 */
  public?: boolean;
}

const GENDER_LABEL: Record<NonNullable<DeceasedInfo["gender"]>, string> = {
  male: "男",
  female: "女",
  other: "其他",
};

/**
 * Produce ERC-721 + DSAS-extension metadata that conforms to
 * `shared/types/tablet.ts::TabletMetadata`.
 *
 * Auto-derives the standard `attributes` array (姓名 / 性別 / 籍貫 /
 * 出生日期 / 逝世日期 / 享壽 / 世代). Date attributes use
 * `display_type: "date"` with unix-second values so OpenSea-style renderers
 * format them correctly.
 *
 * Throws on missing required fields with a clear message.
 */
export function buildTabletMetadata(
  input: TabletMetadataInput,
): TabletMetadata {
  const { deceased } = input;
  if (!deceased) {
    throw new Error("buildTabletMetadata: deceased is required");
  }
  if (!deceased.name || deceased.name.trim().length === 0) {
    throw new Error("buildTabletMetadata: deceased.name is required");
  }

  const image = input.image ?? input.assets?.portrait;
  if (!image) {
    throw new Error(
      "buildTabletMetadata: image (or assets.portrait) is required",
    );
  }

  const attributes: ERC721Attribute[] = [
    { trait_type: "姓名", value: deceased.name },
  ];

  if (deceased.gender) {
    attributes.push({ trait_type: "性別", value: GENDER_LABEL[deceased.gender] });
  }
  if (deceased.origin) {
    attributes.push({ trait_type: "籍貫", value: deceased.origin });
  }

  const birthUnix = deceased.birth?.date ? toUnixSeconds(deceased.birth.date) : undefined;
  const deathUnix = deceased.death?.date ? toUnixSeconds(deceased.death.date) : undefined;

  if (birthUnix !== undefined) {
    attributes.push({
      trait_type: "出生日期",
      display_type: "date",
      value: birthUnix,
    });
  }
  if (deathUnix !== undefined) {
    attributes.push({
      trait_type: "逝世日期",
      display_type: "date",
      value: deathUnix,
    });
  }

  const lifespan = computeLifespan(deceased.birth?.date, deceased.death?.date);
  if (lifespan !== undefined) {
    attributes.push({ trait_type: "享壽", value: lifespan });
  }

  attributes.push({ trait_type: "世代", value: input.generation ?? 0 });

  return {
    name: deceased.name,
    description: input.description ?? autoDescription(deceased),
    image,
    ...(input.external_url ? { external_url: input.external_url } : {}),
    attributes,
    dsas: {
      version: "1.0",
      deceased,
      ...(input.descendants ? { descendants: input.descendants } : {}),
      ...(input.assets ? { assets: input.assets } : {}),
      ...(input.artifact ? { artifact: input.artifact } : {}),
      ...(input.consent ? { consent: input.consent } : {}),
      ...(input.avatar?.avatarLabel || input.avatar?.simliFaceId
        ? { avatar: input.avatar }
        : {}),
      ...(input.stories && input.stories.length > 0 ? { stories: input.stories } : {}),
      ...(input.background ? { background: input.background } : {}),
      ...(input.public !== undefined ? { public: input.public } : {}),
    },
  };
}

function toUnixSeconds(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) {
    throw new Error(
      `buildTabletMetadata: invalid date "${iso}" (expected ISO 8601, e.g. 1940-02-15)`,
    );
  }
  return Math.floor(t / 1000);
}

function computeLifespan(
  birth: string | undefined,
  death: string | undefined,
): number | undefined {
  if (!birth || !death) return undefined;
  const b = new Date(birth);
  const d = new Date(death);
  if (Number.isNaN(b.getTime()) || Number.isNaN(d.getTime())) return undefined;
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  const m = d.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && d.getUTCDate() < b.getUTCDate())) {
    age -= 1;
  }
  return age >= 0 ? age : undefined;
}

function autoDescription(d: DeceasedInfo): string {
  const parts: string[] = [];
  if (d.birth?.date) {
    const y = d.birth.date.slice(0, 4);
    parts.push(`${y} 年生${d.birth.place ? `於${d.birth.place}` : ""}`);
  }
  if (d.death?.date) {
    const y = d.death.date.slice(0, 4);
    parts.push(`${y} 年逝${d.death.place ? `於${d.death.place}` : ""}`);
  }
  if (d.biography) parts.push(d.biography);
  if (d.epitaph) parts.push(`「${d.epitaph}」`);
  return parts.join(",") || d.name;
}
