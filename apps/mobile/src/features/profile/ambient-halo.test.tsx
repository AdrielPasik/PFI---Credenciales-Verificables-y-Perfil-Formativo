import { render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Animated } from 'react-native';

import { AmbientHalo } from '@/features/profile/ambient-halo';

describe('halo ambiental de la banda de bienvenida', () => {
  let reduceMotion: jest.SpyInstance;
  let loop: jest.SpyInstance;

  beforeEach(() => {
    loop = jest.spyOn(Animated, 'loop').mockReturnValue({
      start: jest.fn(),
      stop: jest.fn(),
      reset: jest.fn()
    } as unknown as Animated.CompositeAnimation);
  });

  afterEach(() => {
    reduceMotion.mockRestore();
    loop.mockRestore();
  });

  it('no se anima cuando el sistema pide reducir movimiento', async () => {
    reduceMotion = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);

    await render(<AmbientHalo />);
    await waitFor(() => expect(reduceMotion).toHaveBeenCalled());

    expect(loop).not.toHaveBeenCalled();
  });

  it('se desplaza en bucle cuando el movimiento está permitido', async () => {
    reduceMotion = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(false);

    await render(<AmbientHalo />);

    await waitFor(() => expect(loop).toHaveBeenCalledTimes(1));
  });

  it('es decorativo: no recibe toques ni se anuncia', async () => {
    reduceMotion = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);

    await render(<AmbientHalo />);

    const halo = screen.getByTestId('ambient-halo', { includeHiddenElements: true });
    expect(halo.props.pointerEvents).toBe('none');
    expect(halo.props.accessibilityElementsHidden).toBe(true);
  });
});
