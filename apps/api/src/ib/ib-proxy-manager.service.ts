import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class IBProxyManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IBProxyManagerService.name);
  private proxyProcess: ChildProcess | null = null;
  private isShuttingDown = false;
  private restartAttempts = 0;
  private readonly maxRestartAttempts = 10;
  private readonly restartDelay = 2000; // 2 seconds between restarts
  private readonly proxyPath: string;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  private readonly pythonPath: string;

  // IB Gateway disconnection tracking
  private ibGatewayDisconnectedSince: Date | null = null;
  private ibGatewayDisconnectNotified = false;
  private readonly disconnectNotifyThresholdMs = 2 * 60 * 1000; // 2 minutes

  constructor(private readonly telegramService: TelegramService) {
    // Path to the proxy script (relative to the trading root)
    this.proxyPath = path.resolve(__dirname, '../../../../ib-proxy/proxy.py');
    this.pythonPath = path.resolve(__dirname, '../../../../ib-proxy/venv/bin/python');
  }

  async onModuleInit() {
    this.logger.log('IB Proxy Manager initializing...');

    // Check if proxy is already running externally (e.g., via PM2)
    const alreadyRunning = await this.checkProxyHealth();
    if (alreadyRunning) {
      this.logger.log('IB Proxy already running externally (PM2), skipping spawn');
    } else {
      await this.startProxy();
    }

    this.startHealthCheck();
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    this.stopHealthCheck();
    await this.stopProxy();
  }

  private async startProxy(): Promise<void> {
    if (this.proxyProcess && !this.proxyProcess.killed) {
      this.logger.log('Proxy already running');
      return;
    }

    try {
      this.logger.log(`Starting IB Proxy from: ${this.proxyPath}`);

      // Spawn the Python proxy process using venv
      this.proxyProcess = spawn(this.pythonPath, [this.proxyPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        env: {
          ...process.env,
          IB_PROXY_PORT: '6680',
        },
      });

      // Handle stdout
      this.proxyProcess.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach((line) => {
          if (line.trim()) {
            this.logger.log(`[Proxy] ${line}`);
          }
        });
      });

      // Handle stderr
      this.proxyProcess.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach((line) => {
          if (line.trim() && !line.includes('WARNING: This is a development server')) {
            this.logger.warn(`[Proxy] ${line}`);
          }
        });
      });

      // Handle process exit
      this.proxyProcess.on('exit', (code, signal) => {
        this.logger.warn(`IB Proxy exited with code ${code}, signal ${signal}`);
        this.proxyProcess = null;

        if (!this.isShuttingDown) {
          this.handleProxyExit();
        }
      });

      // Handle process error
      this.proxyProcess.on('error', (error) => {
        this.logger.error(`IB Proxy error: ${error.message}`);
        this.proxyProcess = null;

        if (!this.isShuttingDown) {
          this.handleProxyExit();
        }
      });

      // Reset restart attempts on successful start
      this.restartAttempts = 0;
      this.logger.log(`IB Proxy started with PID: ${this.proxyProcess.pid}`);

    } catch (error) {
      this.logger.error(`Failed to start IB Proxy: ${(error as Error).message}`);
      this.handleProxyExit();
    }
  }

  private handleProxyExit(): void {
    if (this.isShuttingDown) {
      return;
    }

    this.restartAttempts++;

    if (this.restartAttempts > this.maxRestartAttempts) {
      this.logger.error(
        `IB Proxy failed to restart after ${this.maxRestartAttempts} attempts. Manual intervention required.`,
      );
      // Reset after a longer delay to allow retry
      setTimeout(() => {
        this.restartAttempts = 0;
        this.startProxy();
      }, 60000); // Wait 1 minute before trying again
      return;
    }

    const delay = this.restartDelay * Math.min(this.restartAttempts, 5); // Max 10 second delay
    this.logger.log(
      `Restarting IB Proxy in ${delay}ms (attempt ${this.restartAttempts}/${this.maxRestartAttempts})`,
    );

    setTimeout(() => {
      this.startProxy();
    }, delay);
  }

  private async stopProxy(): Promise<void> {
    if (!this.proxyProcess) {
      return;
    }

    this.logger.log('Stopping IB Proxy...');

    return new Promise((resolve) => {
      if (!this.proxyProcess) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        if (this.proxyProcess && !this.proxyProcess.killed) {
          this.logger.warn('Proxy did not stop gracefully, forcing kill');
          this.proxyProcess.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      this.proxyProcess.once('exit', () => {
        clearTimeout(timeout);
        this.logger.log('IB Proxy stopped');
        resolve();
      });

      this.proxyProcess.kill('SIGTERM');
    });
  }

  private startHealthCheck(): void {
    // Check proxy health every 30 seconds
    this.healthCheckInterval = setInterval(async () => {
      if (this.isShuttingDown) {
        return;
      }

      const isHealthy = await this.checkProxyHealth();

      // Only attempt to spawn if:
      // 1. Proxy is not healthy
      // 2. We spawned it ourselves (proxyProcess is not null means we manage it)
      // If proxyProcess is null and proxy is unhealthy, it's likely managed externally (PM2)
      // and we should NOT try to spawn - let PM2 handle restarts
      if (!isHealthy && this.proxyProcess) {
        this.logger.warn('Proxy health check failed, our spawned process may have died');
        // The exit handler will handle restart
      } else if (!isHealthy && !this.proxyProcess) {
        // Proxy is down and we didn't spawn it - log but don't try to spawn
        // PM2 should handle this
        this.logger.warn('Proxy health check failed - proxy managed externally, waiting for PM2 restart');
      }

      // Check IB Gateway connection status (runs regardless of who manages proxy)
      await this.checkIBGatewayConnection();
    }, 30000);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private async checkProxyHealth(): Promise<boolean> {
    try {
      const response = await fetch('http://localhost:6680/health', {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async checkIBGatewayConnection(): Promise<void> {
    try {
      const response = await fetch('http://localhost:6680/status', {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return;
      }

      const status = (await response.json()) as { connected: boolean };
      const isConnected = status.connected;

      if (!isConnected) {
        // IB Gateway is disconnected
        if (!this.ibGatewayDisconnectedSince) {
          // Start tracking disconnection time
          this.ibGatewayDisconnectedSince = new Date();
          this.logger.warn('[IB Gateway] Disconnection detected, starting 2-minute timer');
        } else {
          // Check if we've been disconnected for more than 2 minutes
          const disconnectedMs = Date.now() - this.ibGatewayDisconnectedSince.getTime();

          if (disconnectedMs >= this.disconnectNotifyThresholdMs && !this.ibGatewayDisconnectNotified) {
            // Send notification
            const disconnectedMinutes = Math.floor(disconnectedMs / 60000);
            this.logger.warn(`[IB Gateway] Disconnected for ${disconnectedMinutes} minutes, sending notification`);

            try {
              await this.telegramService.sendMessage(
                `⚠️ IB Gateway Disconnected\n\nIB Gateway has been disconnected for more than 2 minutes.\n\nDisconnected since: ${this.ibGatewayDisconnectedSince.toLocaleString()}`,
              );
              this.ibGatewayDisconnectNotified = true;
            } catch (error) {
              this.logger.error(`Failed to send disconnect notification: ${(error as Error).message}`);
            }
          }
        }
      } else {
        // IB Gateway is connected
        if (this.ibGatewayDisconnectedSince) {
          // Was disconnected, now reconnected
          const wasDisconnectedMs = Date.now() - this.ibGatewayDisconnectedSince.getTime();
          const disconnectedMinutes = Math.floor(wasDisconnectedMs / 60000);
          const disconnectedSeconds = Math.floor((wasDisconnectedMs % 60000) / 1000);

          this.logger.log(`[IB Gateway] Reconnected after ${disconnectedMinutes}m ${disconnectedSeconds}s`);

          // Send reconnection notification if we had sent a disconnect notification
          if (this.ibGatewayDisconnectNotified) {
            try {
              await this.telegramService.sendMessage(
                `✅ IB Gateway Reconnected\n\nIB Gateway is back online.\n\nWas disconnected for: ${disconnectedMinutes}m ${disconnectedSeconds}s`,
              );
            } catch (error) {
              this.logger.error(`Failed to send reconnect notification: ${(error as Error).message}`);
            }
          }

          // Reset tracking
          this.ibGatewayDisconnectedSince = null;
          this.ibGatewayDisconnectNotified = false;
        }
      }
    } catch (error) {
      // Can't reach proxy - don't track this as IB Gateway disconnection
      // (proxy health check handles proxy issues separately)
      this.logger.debug(`[IB Gateway] Status check failed: ${(error as Error).message}`);
    }
  }

  /**
   * Get proxy status for external monitoring
   */
  getStatus(): {
    running: boolean;
    pid: number | null;
    restartAttempts: number;
    ibGateway: {
      disconnectedSince: Date | null;
      disconnectNotified: boolean;
    };
  } {
    return {
      running: this.proxyProcess !== null && !this.proxyProcess.killed,
      pid: this.proxyProcess?.pid ?? null,
      restartAttempts: this.restartAttempts,
      ibGateway: {
        disconnectedSince: this.ibGatewayDisconnectedSince,
        disconnectNotified: this.ibGatewayDisconnectNotified,
      },
    };
  }

  /**
   * Manually restart the proxy
   */
  async restart(): Promise<void> {
    this.logger.log('Manual proxy restart requested');
    await this.stopProxy();
    this.restartAttempts = 0;
    await this.startProxy();
  }
}
