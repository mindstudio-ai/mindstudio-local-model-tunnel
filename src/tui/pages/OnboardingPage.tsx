import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { NavigationMenu } from '../components/index.js';
import type { MenuItem } from '../components/index.js';
import { useAuth } from '../hooks/useAuth.js';
import { getApiKey } from '../../config.js';
import { LogoString } from '../../helpers.js';

type WizardStep = 'welcome' | 'auth';

interface OnboardingPageProps {
  onComplete: () => void;
}

const STEP_LABELS: { key: WizardStep; label: string }[] = [
  { key: 'welcome', label: 'Welcome' },
  { key: 'auth', label: 'Authenticate' },
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

export function OnboardingPage({ onComplete }: OnboardingPageProps) {
  const [wizardStep, setWizardStep] = useState<WizardStep>(() => {
    if (getApiKey()) return 'auth';
    return 'welcome';
  });

  // Auth hook
  const { status: authStatus, authUrl, timeRemaining, startAuth, cancel: cancelAuth } = useAuth();

  // Start auth when entering auth step
  useEffect(() => {
    if (wizardStep === 'auth') {
      startAuth();
      return () => cancelAuth();
    }
  }, [wizardStep]);

  // Auto-advance to dashboard on auth success
  useEffect(() => {
    if (wizardStep === 'auth' && authStatus === 'success') {
      const timer = setTimeout(() => onComplete(), 1500);
      return () => clearTimeout(timer);
    }
  }, [wizardStep, authStatus, onComplete]);

  const handleGetStarted = useCallback(() => {
    if (getApiKey()) {
      onComplete();
    } else {
      setWizardStep('auth');
    }
  }, [onComplete]);

  // --- Welcome Step ---
  const welcomeMenuItems = useMemo((): MenuItem[] => [
    { id: 'get-started', label: 'Get Started', description: 'Begin setup wizard' },
  ], []);

  const handleWelcomeSelect = useCallback((id: string) => {
    if (id === 'get-started') handleGetStarted();
  }, [handleGetStarted]);

  // --- Auth Step ---
  const authMenuItems = useMemo((): MenuItem[] => {
    const items: MenuItem[] = [];
    if (authStatus === 'expired' || authStatus === 'timeout') {
      items.push({ id: 'retry', label: 'Try Again', description: 'Restart authentication' });
    }
    return items;
  }, [authStatus]);

  const handleAuthSelect = useCallback((id: string) => {
    if (id === 'retry') {
      cancelAuth();
      startAuth();
    }
  }, [cancelAuth, startAuth]);

  return (
    <Box flexDirection="column" flexGrow={1}>
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
            <Text>Let's get you set up. We'll connect your MindStudio account.</Text>
            <Box marginTop={1}>
              <Text color="gray">This only takes a minute.</Text>
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

      <Box flexGrow={1} />

      {/* Navigation Menu per step */}
      {wizardStep === 'welcome' && (
        <NavigationMenu items={welcomeMenuItems} onSelect={handleWelcomeSelect} />
      )}
      {wizardStep === 'auth' && authStatus !== 'success' && (
        <NavigationMenu items={authMenuItems} onSelect={handleAuthSelect} />
      )}
    </Box>
  );
}
