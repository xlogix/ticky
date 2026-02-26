export function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function isChannelNotFoundError(error: unknown): boolean {
  const slackError = error as { data?: { error?: string } };
  return slackError?.data?.error === "channel_not_found";
}
