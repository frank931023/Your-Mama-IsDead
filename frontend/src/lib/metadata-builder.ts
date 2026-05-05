import type {
  Artifact,
  Assets,
  Consent,
  DeceasedInfo,
  DescendantSnapshot,
  ERC721Attribute,
  TabletMetadata,
} from "@shared/types/tablet";

/**
 * Browser-pure mirror of `storage/src/metadata_builder.ts::buildTabletMetadata`.
 * Keeps the two implementations in lock-step on attribute order + naming so a
 * front-end-built JSON matches what the backend would produce.
 */

export interface TabletMetadataInput {
  deceased: DeceasedInfo;
  generation?: number;
  image?: string;
  description?: string;
  external_url?: string;
  descendants?: DescendantSnapshot[];
  assets?: Assets;
  artifact?: Artifact;
  consent?: Consent;
}

const GENDER_LABEL: Record<NonNullable<DeceasedInfo["gender"]>, string> = {
  male: "男",
  female: "女",
  other: "其他",
};

export function buildTabletMetadata(input: TabletMetadataInput): TabletMetadata {
  const { deceased } = input;
  if (!deceased) throw new Error("buildTabletMetadata: deceased is required");
  if (!deceased.name || deceased.name.trim().length === 0) {
    throw new Error("buildTabletMetadata: deceased.name is required");
  }

  const image = input.image ?? input.assets?.portrait;
  if (!image) {
    throw new Error("buildTabletMetadata: image (or assets.portrait) is required");
  }

  const attributes: ERC721Attribute[] = [{ trait_type: "姓名", value: deceased.name }];

  if (deceased.gender) {
    attributes.push({ trait_type: "性別", value: GENDER_LABEL[deceased.gender] });
  }
  if (deceased.origin) {
    attributes.push({ trait_type: "籍貫", value: deceased.origin });
  }

  const birthUnix = deceased.birth?.date ? toUnixSeconds(deceased.birth.date) : undefined;
  const deathUnix = deceased.death?.date ? toUnixSeconds(deceased.death.date) : undefined;

  if (birthUnix !== undefined) {
    attributes.push({ trait_type: "出生日期", display_type: "date", value: birthUnix });
  }
  if (deathUnix !== undefined) {
    attributes.push({ trait_type: "逝世日期", display_type: "date", value: deathUnix });
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

function computeLifespan(birth: string | undefined, death: string | undefined): number | undefined {
  if (!birth || !death) return undefined;
  const b = new Date(birth);
  const d = new Date(death);
  if (Number.isNaN(b.getTime()) || Number.isNaN(d.getTime())) return undefined;
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  const m = d.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && d.getUTCDate() < b.getUTCDate())) age -= 1;
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
