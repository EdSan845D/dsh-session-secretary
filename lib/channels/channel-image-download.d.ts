import type { ImMedia } from '../engine/types.js';
export declare const MAX_CHANNEL_IMAGE_BYTES: number;
export declare const MAX_CHANNEL_IMAGES = 4;
/** Only return fixed categories or HTTP status digits; raw SDK errors can hold secrets. */
export declare function channelImageFailureReason(error: unknown): string;
/** Diagnostic host only: never emit a signed path/query, userinfo, or AES key. */
export declare function channelImageDownloadHost(raw?: string): string;
/** Infer MIME from bytes, not an attacker-controlled filename or Content-Type. */
export declare function imageMedia(data: Buffer, maxBytes?: number): ImMedia;
export interface ChannelByteRequestOptions {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    maxBytes?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    additionalTrustedHosts?: readonly string[];
    /** 只跟随同一主机的 HTTPS 跳转，令牌不会被带到别的域名。默认不跟随。 */
    sameHostRedirects?: number;
    /** 自定义 fetcher（用于账号级代理分流，挂载 ProxyAgent） */
    fetcher?: typeof fetch;
}
/** HTTPS only; 未注入 fetcher 时走本地原生连接查找与 DNS rebinding 防护（直连无环境代理）；
 * 传入 fetcher 时通过账号级代理分流。仅限同主机重定向。IPv4-only 模式在纯 IPv6 主机上明确快速失败。
 */
export declare function requestChannelBytes(rawUrl: string, options?: ChannelByteRequestOptions): Promise<Buffer>;
/** 通用文件不套用图片魔数验证，文件类型和格式由 Chat 接收策略判断。 */
export declare function fileMedia(data: Buffer, name?: string, maxBytes?: number): ImMedia;
//# sourceMappingURL=channel-image-download.d.ts.map