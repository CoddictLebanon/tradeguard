import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

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

  constructor() {
    // Path to the proxy script (relative to the trading root)
    this.proxyPath = path.resolve(__dirname, '../../../../ib-proxy/proxy.py');
    this.pythonPath = path.resolve(__dirname, '../../../../ib-proxy/venv/bin/python');
  }

  async onModuleInit() {
    this.logger.log('IB Proxy Manager initializing...');
    await this.startProxy();
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
      if (!isHealthy && !this.proxyProcess) {
        this.logger.warn('Proxy health check failed, attempting restart...');
        this.startProxy();
      }
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

  /**
   * Get proxy status for external monitoring
   */
  getStatus(): {
    running: boolean;
    pid: number | null;
    restartAttempts: number;
  } {
    return {
      running: this.proxyProcess !== null && !this.proxyProcess.killed,
      pid: this.proxyProcess?.pid ?? null,
      restartAttempts: this.restartAttempts,
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
