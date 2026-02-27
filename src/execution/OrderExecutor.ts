import { Connection, Keypair, VersionedTransaction, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import fetch from "node-fetch";
import { CONFIG } from "../config.js";
import type { 
  IExecutionLayer, 
  ExecutionResult, 
  ExecutionOptions 
} from "./interfaces/IExecutionLayer.js";
import { SlippageModel } from "./SlippageModel.js";

export class OrderExecutor implements IExecutionLayer {
  private readonly connection: Connection;
  private readonly wallet: Keypair;
//   private readonly USDC_MINT = "EPjFW36vnm7HqeogAq6Qg3LXYrDhwd6cfjSbwFrEBdis";
  private readonly SOL_MINT = "So11111111111111111111111111111111111111112";

  constructor() {
    this.connection = new Connection(CONFIG.RPC_URL, "confirmed");

    // 1. Extract and Clean Key
    const rawKey = (CONFIG.WALLET_PRIVATE_KEY || "").trim();

    // 2. Initialize Wallet Safely
    if (rawKey.length > 0) {
      try {
        const secretKey = bs58.decode(rawKey);
        this.wallet = Keypair.fromSecretKey(secretKey);
      } catch (e) {
        // If we are in LIVE mode, this is a fatal error
        if (CONFIG.EXECUTION_MODE === "LIVE") {
          throw new Error("FATAL: Invalid WALLET_PRIVATE_KEY format. Base58 decode failed.");
        }
        // In DRY_RUN, we just generate a random throwaway key so the class doesn't crash
        this.wallet = Keypair.generate();
      }
    } else {
      // No key provided - generate random one for DRY_RUN support
      this.wallet = Keypair.generate();
    }
  }

  public async executeBuy(options: ExecutionOptions): Promise<ExecutionResult> {
    if (CONFIG.EXECUTION_MODE === "DRY_RUN") return this.handleDryRun("BUY", options);
    return this.handleLiveSwap("BUY", options);
  }

  public async executeSell(options: ExecutionOptions): Promise<ExecutionResult> {
    if (CONFIG.EXECUTION_MODE === "DRY_RUN") return this.handleDryRun("SELL", options);
    return this.handleLiveSwap("SELL", options);
  }

 private async handleLiveSwap(side: "BUY" | "SELL", options: ExecutionOptions): Promise<ExecutionResult> {
    console.log(`\n[LIVE] Initializing ${side} for ${options.tokenAddress}...`);

    const inputMint = side === "BUY" ? this.SOL_MINT : options.tokenAddress;
    const outputMint = side === "BUY" ? options.tokenAddress : this.SOL_MINT;

    try {
      // 1. GET CURRENT SOL PRICE
      const solPriceRes = await fetch(`https://api.jup.ag/price/v2?ids=SOL`);
      const solPriceData: any = await solPriceRes.json();
      const solUsdPrice = parseFloat(solPriceData.data.SOL.price);

      // 2. CALCULATE RAW LAMPS (9 Decimals for SOL)
      let amountRaw: string;
      if (side === "BUY") {
        // We use the smaller of (Strategy USD amount) or (Micro Position Cap)
        const usdToSpend = Math.min(options.amountUsd!, CONFIG.MAX_MICRO_POSITION_USD);
        const solToSpend = usdToSpend / solUsdPrice;
        
        // Convert SOL to Lamports (10^9)
        amountRaw = Math.floor(solToSpend * 1_000_000_000).toString();
        console.log(`[LIVE] Action: Buying with ${solToSpend.toFixed(4)} SOL (~$${usdToSpend.toFixed(2)})`);
      } else {
        // Selling: Convert token quantity to raw units (assuming 6 decimals for pump.fun tokens)
        // If the token has 9 decimals, this will be handled by the quote API automatically
        amountRaw = Math.floor(options.quantity! * 1_000_000).toString();
      }

      // 3. GET JUPITER V6 QUOTE
      const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountRaw}&slippageBps=${CONFIG.SLIPPAGE_TOLERANCE_BPS}`;
      const quoteResponse = await fetch(quoteUrl);
      const quoteData: any = await quoteResponse.json();

      if (!quoteData.outAmount) throw new Error("Jupiter Quote Failed. Check liquidity/mint.");

      // 4. GET SWAP TRANSACTION
      const swapResponse = await fetch("https://quote-api.jup.ag/v6/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: quoteData,
          userPublicKey: this.wallet.publicKey.toString(),
          wrapAndUnwrapSol: true,
          prioritizationFeeLamports: 100000, 
        }),
      });
      const { swapTransaction } = await swapResponse.json() as any;

      // 5. SIGN & DISPATCH
      const transaction = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
      transaction.sign([this.wallet]);

      const txid = await this.connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      console.log(`[LIVE TX SENT] Sig: https://solscan.io/tx/${txid}`);

      // 6. CONFIRMATION
      await this.connection.confirmTransaction(txid, "confirmed");
      console.log(`[LIVE TX CONFIRMED]`);

      return {
        filledPrice: options.marketPrice, 
        filledQuantity: side === "BUY" ? parseFloat(quoteData.outAmount) / 1_000_000 : options.quantity!,
        slippage: parseFloat(quoteData.priceImpactPct || "0") / 100,
        rawTxHash: txid,
      };

    } catch (error) {
      console.error("[LIVE ERROR] Execution Failed:", error);
      throw error;
    }
  }

  private handleDryRun(side: "BUY" | "SELL", options: ExecutionOptions): ExecutionResult {
    const MOCK_LIQUIDITY = 500_000;
    const amountUsd = options.amountUsd ?? (options.quantity! * options.marketPrice);
    const estimatedSlippage = SlippageModel.estimateImpact(amountUsd, MOCK_LIQUIDITY);
    const priceImpact = side === "BUY" ? (1 + estimatedSlippage) : (1 - estimatedSlippage);
    const filledPrice = options.marketPrice * priceImpact;

    return {
      filledPrice,
      filledQuantity: amountUsd / filledPrice,
      slippage: estimatedSlippage,
      rawTxHash: `DRY_RUN_${side}_${Date.now()}`
    };
  }

  // Stubs for Interface compliance
  public async estimateSlippage() { return 0.005; }
  public async cancelOrder() { return true; }
}
