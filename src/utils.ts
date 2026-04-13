export async function killGracefully(
	proc: ReturnType<typeof Bun.spawn>,
): Promise<void> {
	proc.kill(15); // SIGTERM
	const didExit = await Promise.race([
		proc.exited.then(() => true),
		new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
	]);
	if (!didExit) {
		proc.kill(9); // SIGKILL
	}
}

/**
 * Read a ReadableStream up to maxBytes, then cancel the rest.
 * Prevents unbounded memory growth from large subprocess output.
 */
export async function readCapped(
	stream: ReadableStream<Uint8Array>,
	maxBytes: number,
): Promise<string> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			const remaining = maxBytes - total;
			if (value.byteLength <= remaining) {
				chunks.push(value);
				total += value.byteLength;
			} else {
				// Take only what fits, then cancel the stream
				chunks.push(value.slice(0, remaining));
				total = maxBytes;
				await reader.cancel();
				break;
			}
		}
	} finally {
		reader.releaseLock();
	}

	const combined = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return new TextDecoder().decode(combined);
}
