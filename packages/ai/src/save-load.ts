/**
 * Save and load model parameters to/from disk.
 *
 * Format: JSON metadata + binary tensor data.
 * - {name}.meta.json: param names, shapes, dtypes, byte offsets
 * - {name}.weights.bin: concatenated raw tensor data
 */

import { numpy as np, tree } from "@jax-js/jax";
import type { Params } from "./train.ts";

interface ParamMeta {
  key: string;
  shape: number[];
  dtype: string;
  byteOffset: number;
  byteLength: number;
}

interface CheckpointMeta {
  params: ParamMeta[];
  totalBytes: number;
  networkConfig: Record<string, any>;
  timestamp: string;
  batch?: number;
}

/** Save model params to disk. */
export async function saveCheckpoint(
  params: Params,
  dir: string,
  name: string,
  extra: { networkConfig?: Record<string, any>; batch?: number } = {},
): Promise<void> {
  const paramMetas: ParamMeta[] = [];
  const buffers: Uint8Array[] = [];
  let byteOffset = 0;

  // Flatten params and extract data
  const keys = Object.keys(params).sort();
  for (const key of keys) {
    const tensor = params[key];
    const data = await tensor.ref.data();  // .ref so tensor survives
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

    paramMetas.push({
      key,
      shape: [...tensor.shape],
      dtype: tensor.dtype,
      byteOffset,
      byteLength: bytes.byteLength,
    });

    buffers.push(bytes);
    byteOffset += bytes.byteLength;
  }

  const meta: CheckpointMeta = {
    params: paramMetas,
    totalBytes: byteOffset,
    networkConfig: extra.networkConfig ?? {},
    timestamp: new Date().toISOString(),
    batch: extra.batch,
  };

  // Write files
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(`${dir}/${name}.meta.json`, JSON.stringify(meta, null, 2));

  // Concatenate buffers
  const allBytes = new Uint8Array(byteOffset);
  let offset = 0;
  for (const buf of buffers) {
    allBytes.set(buf, offset);
    offset += buf.byteLength;
  }
  await Deno.writeFile(`${dir}/${name}.weights.bin`, allBytes);

  console.log(`Saved checkpoint: ${dir}/${name} (${(byteOffset / 1024).toFixed(0)} KB, ${keys.length} params)`);
}

/** Load model params from disk. */
export async function loadCheckpoint(
  dir: string,
  name: string,
): Promise<{ params: Params; meta: CheckpointMeta }> {
  const metaText = await Deno.readTextFile(`${dir}/${name}.meta.json`);
  const meta: CheckpointMeta = JSON.parse(metaText);

  const allBytes = await Deno.readFile(`${dir}/${name}.weights.bin`);

  const params: Params = {};
  for (const pm of meta.params) {
    const slice = allBytes.slice(pm.byteOffset, pm.byteOffset + pm.byteLength);

    let typedArray: Float32Array | Int32Array;
    if (pm.dtype === "float32") {
      typedArray = new Float32Array(slice.buffer, slice.byteOffset, slice.byteLength / 4);
    } else if (pm.dtype === "int32") {
      typedArray = new Int32Array(slice.buffer, slice.byteOffset, slice.byteLength / 4);
    } else {
      throw new Error(`Unsupported dtype: ${pm.dtype}`);
    }

    params[pm.key] = np.array(typedArray).reshape(pm.shape);
  }

  console.log(`Loaded checkpoint: ${dir}/${name} (${meta.params.length} params, batch ${meta.batch ?? "?"})`);
  return { params, meta };
}

/** List checkpoints in a directory. */
export async function listCheckpoints(dir: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.name.endsWith(".meta.json")) {
        names.push(entry.name.replace(".meta.json", ""));
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return names.sort();
}
