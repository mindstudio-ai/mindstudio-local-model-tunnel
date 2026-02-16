import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Box, Text, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import { NavigationMenu } from '../components/index.js';
import type { MenuItem } from '../components/index.js';
import { useAuth } from '../hooks/useAuth.js';
import { useSetupProviders } from '../hooks/useSetupProviders.js';
import { getApiKey } from '../../config.js';
import { LogoString } from '../../helpers.js';
import type { ProviderInfo } from '../../quickstart/detect.js';

type WizardStep = 'welcome' | 'auth' | 'providers' | 'complete';

interface OnboardingPageProps {
  onComplete: () => void;
  onExternalAction: (action: string) => void;
}

const STEP_LABELS: { key: WizardStep; label: string }[] = [
  { key: 'welcome', label: 'Welcome' },
  { key: 'auth', label: 'Authenticate' },
  { key: 'providers', label: 'Providers' },
  { key: 'complete', label: 'Ready' },
];

function ProgressIndicator({ currentStep }: { currentStep: WizardStep }) {
  return (
    <Box marginBottom={1}>
      {STEP_LABELS.map((step, i) => {
        const isCurrent = step.key === currentStep;
        const currentIdx = STEP_LABELS.findIndex((s) => s.key === currentStep);
        const isDone = i < currentIdx;

        return (
          <Box key={step.key}>
            <Text color={isCurrent ? 'cyan' : isDone ? 'green' : 'gray'} bold={isCurrent}>
              {isDone ? '\u25CF' : isCurrent ? '\u25CF' : '\u25CB'} {step.label}
            </Text>
            {i < STEP_LABELS.length - 1 && (
              <Text color="gray">{' \u2500\u2500 '}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

export function OnboardingPage({ onComplete, onExternalAction }: OnboardingPageProps) {
  const { stdout } = useStdout();
  const termHeight = (stdout?.rows ?? 24) - 4;

  // Determine initial step based on existing state
  const [wizardStep, setWizardStep] = useState<WizardStep>(() => {
    if (getApiKey()) return 'providers';
    return 'welcome';
  });

  // Auth hook
  const { status: authStatus, authUrl, timeRemaining, startAuth, cancel: cancelAuth } = useAuth();

  // Provider detection hook
  const { providers, loading: providersLoading, sdModelExists, comfyModelStatus, refresh: refreshProviders } = useSetupProviders();

  // Start auth when entering auth step
  useEffect(() => {
    if (wizardStep === 'auth') {
      startAuth();
      return () => cancelAuth();
    }
  }, [wizardStep]);

  // Auto-advance from auth to providers on success
  useEffect(() => {
    if (wizardStep === 'auth' && authStatus === 'success') {
      const timer = setTimeout(() => setWizardStep('providers'), 1500);
      return () => clearTimeout(timer);
    }
  }, [wizardStep, authStatus]);

  const handleGetStarted = useCallback(() => {
    if (getApiKey()) {
      setWizardStep('providers');
    } else {
      setWizardStep('auth');
    }
  }, []);

  const handleSkip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  // --- Welcome Step ---
  const welcomeMenuItems = useMemo((): MenuItem[] => [
    { id: 'get-started', label: 'Get Started', description: 'Begin setup wizard' },
    { id: 'skip', label: 'Skip', description: 'Go straight to dashboard' },
  ], []);

  const handleWelcomeSelect = useCallback((id: string) => {
    if (id === 'get-started') handleGetStarted();
    else if (id === 'skip' || id === 'quit') handleSkip();
  }, [handleGetStarted, handleSkip]);

  // --- Auth Step ---
  const authMenuItems = useMemo((): MenuItem[] => {
    const items: MenuItem[] = [];
    if (authStatus === 'expired' || authStatus === 'timeout') {
      items.push({ id: 'retry', label: 'Try Again', description: 'Restart authentication' });
    }
    items.push({ id: 'skip', label: 'Skip', description: 'Continue without authenticating' });
    return items;
  }, [authStatus]);

  const handleAuthSelect = useCallback((id: string) => {
    if (id === 'retry') {
      cancelAuth();
      startAuth();
    } else if (id === 'skip' || id === 'quit') {
      cancelAuth();
      setWizardStep('providers');
    }
  }, [cancelAuth, startAuth]);

  // --- Providers Step ---
  const providerMenuItems = useMemo((): MenuItem[] => {
    if (providersLoading || providers.length === 0) {
      return [
        { id: 'continue', label: 'Continue', description: 'Proceed to finish' },
      ];
    }

    const items: MenuItem[] = [];
    const ollama = providers.find((p) => p.id === 'ollama');
    const lmstudio = providers.find((p) => p.id === 'lmstudio');
    const sd = providers.find((p) => p.id === 'stable-diffusion');
    const comfyui = providers.find((p) => p.id === 'comfyui');

    // --- Text Generation ---
    if (ollama && !ollama.installed) {
      items.push({
        id: 'install-ollama',
        label: ollama.installable
          ? 'Install Ollama (automatic)'
          : 'Download Ollama (opens browser)',
        description: 'Install Ollama for text generation',
      });
    } else if (ollama && ollama.installed && !ollama.running) {
      items.push({
        id: 'start-ollama',
        label: 'Start Ollama',
        description: 'Start the Ollama server',
      });
    }

    if (lmstudio && !lmstudio.installed) {
      items.push({
        id: 'install-lmstudio',
        label: 'Download LM Studio (opens browser)',
        description: 'Download LM Studio app',
      });
    }

    // --- Image Generation ---
    if (sd) {
      if (sd.warning) {
        items.push({
          id: 'fix-python',
          label: 'Install Python 3.13 (required for Forge Neo)',
          description: 'Show Python installation instructions',
        });
      }
      if (!sd.installed) {
        // SD install handled in-app
      } else if (!sd.running) {
        items.push({
          id: 'start-sd',
          label: 'Start Stable Diffusion server',
          description: 'Start the SD Forge Neo server',
        });
      }
      if (sd.installed && !sdModelExists) {
        items.push({
          id: 'download-sd-model',
          label: 'Download default SDXL model (~6.5 GB)',
          description: 'Download sd_xl_base_1.0 from Hugging Face',
        });
      }
    }

    // --- Video Generation ---
    if (comfyui) {
      if (!comfyui.installed) {
        // ComfyUI install handled in-app
      } else if (!comfyui.running) {
        items.push({
          id: 'start-comfyui',
          label: 'Start ComfyUI server',
          description: 'Start the ComfyUI server',
        });
      } else {
        for (const model of comfyModelStatus) {
          if (!model.installed) {
            items.push({
              id: `download-comfyui-model:${model.id}`,
              label: `Download ${model.label} (${model.totalSize})`,
              description: `Download ${model.label} model files`,
            });
          }
        }
      }
    }

    items.push({ id: 'refresh', label: 'Refresh', description: 'Re-detect providers' });
    items.push({ id: 'continue', label: 'Continue', description: 'Proceed to finish' });
    items.push({ id: 'skip', label: 'Skip to Dashboard', description: 'Skip remaining setup' });

    return items;
  }, [providers, providersLoading, sdModelExists, comfyModelStatus]);

  const handleProviderSelect = useCallback((id: string) => {
    if (id === 'continue') {
      setWizardStep('complete');
    } else if (id === 'skip' || id === 'quit') {
      handleSkip();
    } else if (id === 'refresh') {
      refreshProviders();
    } else {
      onExternalAction(id);
    }
  }, [handleSkip, refreshProviders, onExternalAction]);

  // --- Complete Step ---
  const completeMenuItems = useMemo((): MenuItem[] => [
    { id: 'go-to-dashboard', label: 'Go to Dashboard', description: 'Start using MindStudio Local' },
  ], []);

  const handleCompleteSelect = useCallback((id: string) => {
    if (id === 'go-to-dashboard' || id === 'quit') {
      onComplete();
    }
  }, [onComplete]);

  // Provider status groups for display
  const providerGroups: Array<{ label: string; ids: string[] }> = [
    { label: 'Text', ids: ['ollama', 'lmstudio'] },
    { label: 'Image', ids: ['stable-diffusion'] },
    { label: 'Video', ids: ['comfyui'] },
  ];

  const hasApiKey = !!getApiKey();
  const runningProviderCount = providers.filter((p) => p.running).length;

  return (
    <Box flexDirection="column" height={termHeight}>
      {/* Progress Indicator */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1} paddingY={1} width="100%">
        <Box>
          <Text color="cyan">{LogoString}</Text>
        </Box>
        <Box flexDirection="column" marginLeft={4} justifyContent="center">
          <Text bold color="white">MindStudio Local Tunnel</Text>
          <Box marginTop={1}>
            <ProgressIndicator currentStep={wizardStep} />
          </Box>
        </Box>
      </Box>

      {/* Step Content */}
      {wizardStep === 'welcome' && (
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Text bold color="white">Welcome to MindStudio Local!</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>Let's get you set up. Here's what we'll do:</Text>
            <Box marginTop={1} flexDirection="column">
              <Text color="cyan">  1. Connect your MindStudio account</Text>
              <Text color="cyan">  2. Set up a local AI provider (like Ollama)</Text>
            </Box>
            <Box marginTop={1}>
              <Text color="gray">This only takes a minute or two.</Text>
            </Box>
          </Box>
        </Box>
      )}

      {wizardStep === 'auth' && (
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Text bold color="white">Connect Your Account</Text>
          <Box marginTop={1} flexDirection="column">
            {authStatus === 'idle' && (
              <Text color="gray">Starting authentication...</Text>
            )}
            {authStatus === 'waiting' && (
              <>
                <Box>
                  <Text color="cyan"><Spinner type="dots" /></Text>
                  <Text> Waiting for browser authorization... ({timeRemaining}s remaining)</Text>
                </Box>
                {authUrl && (
                  <Box flexDirection="column" marginTop={1}>
                    <Text color="gray">If browser didn't open, visit:</Text>
                    <Text color="cyan">{authUrl}</Text>
                  </Box>
                )}
              </>
            )}
            {authStatus === 'success' && (
              <>
                <Text color="green">{'\u2713'} Authenticated successfully!</Text>
                <Text color="gray">Continuing...</Text>
              </>
            )}
            {(authStatus === 'expired' || authStatus === 'timeout') && (
              <Text color="red">
                {authStatus === 'expired'
                  ? 'Authorization expired.'
                  : 'Authorization timed out.'}
              </Text>
            )}
          </Box>
        </Box>
      )}

      {wizardStep === 'providers' && (
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Text bold color="white">Set Up Providers</Text>
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="gray"
            paddingX={1}
            marginTop={1}
          >
            {providersLoading ? (
              <Box>
                <Text color="cyan"><Spinner type="dots" /></Text>
                <Text> Detecting providers...</Text>
              </Box>
            ) : (
              providerGroups.map((group) => {
                const groupProviders = providers.filter((p) => group.ids.includes(p.id));
                if (groupProviders.length === 0) return null;
                return (
                  <Box key={group.label} marginTop={1} flexDirection="column">
                    <Text color="gray" dimColor>{group.label}</Text>
                    {groupProviders.map((provider: ProviderInfo) => (
                      <Box key={provider.id} flexDirection="column">
                        <Box>
                          <Text color={provider.installed ? (provider.running ? 'green' : 'yellow') : 'red'}>
                            {provider.installed ? (provider.running ? '\u25CF' : '\u25CB') : '\u2717'}
                          </Text>
                          <Text> {provider.name} - </Text>
                          <Text color="gray">
                            {provider.running
                              ? 'Running'
                              : provider.installed
                                ? 'Installed (not running)'
                                : 'Not installed'}
                          </Text>
                        </Box>
                        {provider.warning && (
                          <Box>
                            <Text color="yellow"> {'\u26A0'} {provider.warning}</Text>
                          </Box>
                        )}
                      </Box>
                    ))}
                  </Box>
                );
              })
            )}
          </Box>
          {!providersLoading && (
            <Box marginTop={1}>
              <Text color="gray" italic>Tip: Ollama is the easiest way to get started with text generation.</Text>
            </Box>
          )}
        </Box>
      )}

      {wizardStep === 'complete' && (
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Text bold color="white">You're All Set!</Text>
          <Box marginTop={1} flexDirection="column">
            <Text color={hasApiKey ? 'green' : 'yellow'}>
              {hasApiKey ? '\u2713' : '\u25CB'} MindStudio {hasApiKey ? 'connected' : 'not connected'}
            </Text>
            <Text color={runningProviderCount > 0 ? 'green' : 'yellow'}>
              {runningProviderCount > 0 ? '\u2713' : '\u25CB'} {runningProviderCount} provider{runningProviderCount !== 1 ? 's' : ''} running
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color="gray">You can always set up more providers from the dashboard.</Text>
          </Box>
        </Box>
      )}

      <Box flexGrow={1} />

      {/* Navigation Menu per step */}
      {wizardStep === 'welcome' && (
        <NavigationMenu items={welcomeMenuItems} onSelect={handleWelcomeSelect} />
      )}
      {wizardStep === 'auth' && authStatus !== 'success' && (
        <NavigationMenu items={authMenuItems} onSelect={handleAuthSelect} />
      )}
      {wizardStep === 'providers' && (
        <NavigationMenu items={providerMenuItems} onSelect={handleProviderSelect} />
      )}
      {wizardStep === 'complete' && (
        <NavigationMenu items={completeMenuItems} onSelect={handleCompleteSelect} />
      )}
    </Box>
  );
}
