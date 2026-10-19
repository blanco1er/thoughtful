// Amazon Bedrock extractor (Converse API). The spending cap is enforced in code BEFORE each call, from a
// worst-case estimate, and recorded AFTER from the real token usage.
import { config, priceFor } from '../config.mjs';
import { SYSTEM, FACTS_SYSTEM, userMessage, factsMessage, parseJson } from './prompt.mjs';


export class SpendCapError extends Error { constructor(m) { super(m); this.code = 'spend_cap'; } }

export function checkCap(spend, { modelId, inputChars, maxOut }, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  if (spend.day !== day) { spend.day = day; spend.usd = 0; }
  const p = priceFor(modelId);
  const worst = (Math.ceil(inputChars / 3.2) * p.in + maxOut * p.out) / 1e6;
  if (spend.usd + worst > config.spendCapDayUsd) throw new SpendCapError(`daily cap ${config.spendCapDayUsd} USD reached`);
  if (spend.totalUsd + worst > config.spendCapTotalUsd) throw new SpendCapError(`total cap ${config.spendCapTotalUsd} USD reached`);
  return worst;
}

export function record(spend, modelId, usage = {}) {
  const p = priceFor(modelId);
  const usd = ((usage.inputTokens || 0) * p.in + (usage.outputTokens || 0) * p.out) / 1e6;
  spend.usd += usd; spend.totalUsd += usd; spend.calls += 1;
  return usd;
}

export function createBedrockExtractor({ spend, sendImpl } = {}) {
  let client = null, Converse = null;
  async function send(input) {
    if (sendImpl) return sendImpl(input);
    if (!client) {
      const sdk = await import('@aws-sdk/client-bedrock-runtime');
      client = new sdk.BedrockRuntimeClient({ region: config.region });
      Converse = sdk.ConverseCommand;
    }
    return client.send(new Converse(input));
  }
  async function call(system, user, maxOut = 1400) {
    const chain = [config.model, config.fallbackModel].filter((m, i, a) => m && a.indexOf(m) === i);
    let lastErr;
    for (const modelId of chain) {
      checkCap(spend, { modelId, inputChars: system.length + user.length, maxOut });
      try {
        const out = await send({
          modelId,
          system: [{ text: system }],
          messages: [{ role: 'user', content: [{ text: user }] }],
          inferenceConfig: { maxTokens: maxOut, temperature: 0 },
        });
        record(spend, modelId, out.usage);
        const text = (out.output?.message?.content || []).map((c) => c.text || '').join('');
        return { json: parseJson(text), modelId, usage: out.usage };
      } catch (e) {
        lastErr = e;
        if (e instanceof SpendCapError) throw e;
        if (!/Throttl|TooManyRequests|ServiceUnavailable|ModelNotReady|AccessDenied|ValidationException/i.test(e?.name + ' ' + e?.message)) throw e;
      }
    }
    throw lastErr;
  }
  return {
    name: 'bedrock',
    async conversation({ conv, ownerName, people, today, timezone }) {
      const r = await call(SYSTEM, userMessage({ conv, ownerName, people, today, timezone }));
      return { items: r.json.items || [], modelId: r.modelId, usage: r.usage };
    },
    async facts({ facts, ownerName, people, today }) {
      if (!facts.length) return { items: [] };
      const r = await call(FACTS_SYSTEM, factsMessage({ facts, ownerName, people, today }), 900);
      return { items: r.json.items || [], modelId: r.modelId, usage: r.usage };
    },
  };
}
