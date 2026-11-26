const mockDimensions = { width: 430, fontScale: 1 };
jest.mock('react-native', () => ({
  View: 'View',
  useWindowDimensions: () => mockDimensions,
  Platform: { select: (values) => values.android },
}));

import ResponsiveRow from '../src/components/ResponsiveRow';
import { normalizeApiUrl } from '../src/config';

describe('responsive action groups', () => {
  test.each([
    [320, 1, 'column'], [360, 1, 'column'], [430, 1, 'row'],
    [768, 1, 'row'], [768, 2, 'column'],
  ])('width %i / font scale %f chooses %s', (width, fontScale, expected) => {
    Object.assign(mockDimensions, { width, fontScale });
    const element = ResponsiveRow({ children: null, style: { flexDirection: 'row' } });
    const style = Object.assign({}, ...element.props.style.filter(Boolean));
    expect(style.flexDirection).toBe(expected);
  });
});

describe('API server origins', () => {
  test('accepts HTTPS release origin', () => {
    expect(normalizeApiUrl(' https://api.example.com/ ', { development: false })).toBe('https://api.example.com');
  });
  test('allows explicit LAN development', () => {
    expect(normalizeApiUrl('http://192.168.1.20:4000', { development: true })).toBe('http://192.168.1.20:4000');
  });
  test.each(['http://api.example.com', 'https://user:password@example.com', 'https://example.com/api', 'https://example.com?token=x', 'ftp://example.com', 'https://example.com:99999'])('rejects unsafe release configuration %s', (value) => {
    expect(() => normalizeApiUrl(value, { development: false })).toThrow();
  });
});
