/**
 * Model vision-capability gate (Royal Mode 2.0 Stage 1a).
 *
 * Decides whether loop.ts may embed a tool's screenshot as a model-visible
 * image part in the tool_result (see providers/types.ts `ToolResultPart`),
 * and whether a provider adapter should map an already-embedded image part
 * to real wire bytes or degrade it to an honest text placeholder (the model
 * can be switched mid-session via lakshx/set_model, so history built for a
 * vision model can be replayed against a non-vision one — both layers gate).
 *
 * Deliberately a conservative ALLOWLIST, not a denylist: sending image
 * blocks to a model/endpoint that doesn't accept them is a hard 4xx that
 * kills the whole turn, while withholding them from a vision model merely
 * loses a nicety (the text signals still flow). Unknown model → no images.
 *
 * `LAKSHX_VISION` overrides the heuristic in both directions:
 *   LAKSHX_VISION=0 → never send images (safe escape hatch);
 *   LAKSHX_VISION=1 → always send them (for vision models this allowlist
 *                     doesn't know about yet).
 */

/**
 * Bare-model-name prefixes known to accept image input on both provider
 * paths we speak (Anthropic Messages, OpenAI-compat chat/completions).
 * Matched against the LAST `/`-segment lowercased, so routed ids like
 * OpenRouter's "anthropic/claude-sonnet-4.5" match too.
 */
const VISION_MODEL_PREFIXES = ["claude-", "gpt-5", "gpt-4o", "gemini-"];

export function isVisionCapableModel(model: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const override = env.LAKSHX_VISION;
  if (override === "0" || override?.toLowerCase() === "false") return false;
  if (override === "1" || override?.toLowerCase() === "true") return true;
  if (!model) return false;
  const bare = model.toLowerCase().split("/").pop() ?? "";
  return VISION_MODEL_PREFIXES.some((p) => bare.startsWith(p));
}

/**
 * The exact placeholder both adapters substitute for an image part when the
 * current model/provider path can't take images — shared so the degradation
 * is uniform and honestly worded (the model is told the screenshot exists
 * but that IT cannot see it, rather than silently dropping it).
 */
export const IMAGE_UNSUPPORTED_PLACEHOLDER =
  "[a screenshot was attached to this tool result, but the current model/provider path does not support image input — rely on the text signals instead]";
