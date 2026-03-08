import { useAuth } from '@/contexts/AuthContext';
import { Redirect } from 'expo-router';

export default function Index() {
  const { userId, isLoading } = useAuth();

  if (isLoading) return null;

  return userId ? <Redirect href="/(tabs)/nexus" /> : <Redirect href="/(auth)/onboarding" />;
}
