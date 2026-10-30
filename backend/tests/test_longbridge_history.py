import asyncio
import os
import sys
import types
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from app import market_data


class LongbridgeHistoryTests(unittest.TestCase):
    def test_recent_fallback_maps_symbol_and_filters_dates(self):
        bar = types.SimpleNamespace(timestamp=datetime(2026, 10, 26, 13, 30, tzinfo=timezone.utc),
                                    open='12', high='14', low='11', close='13', volume=500, turnover='6500')
        class Context:
            def __init__(self, _config): pass
            def history_candlesticks_by_date(self, symbol, *_args):
                self.symbol = symbol
                raise RuntimeError('301607 quota')
            def candlesticks(self, symbol, *_args):
                self.assert_symbol = symbol
                if symbol != 'GOOGL.US':
                    raise AssertionError(symbol)
                return [bar]
        sdk = types.ModuleType('longbridge.openapi')
        sdk.Config = types.SimpleNamespace(from_apikey_env=lambda: None)
        sdk.OAuthBuilder = object
        sdk.QuoteContext = Context
        sdk.Period = types.SimpleNamespace(Day=1)
        sdk.AdjustType = types.SimpleNamespace(NoAdjust=0)
        with patch.dict(sys.modules, {'longbridge': types.ModuleType('longbridge'), 'longbridge.openapi': sdk}), \
                patch.dict(os.environ, {'LONGBRIDGE_OAUTH_CLIENT_ID': ''}):
            bars = market_data._longbridge_history('GOOGL.O', '2026-10-24', '2026-10-30')
        self.assertEqual(bars, [{'date': '2026-10-26', 'open': 12.0, 'high': 14.0,
                                 'low': 11.0, 'close': 13.0, 'volume': 500.0, 'amount': 6500.0}])

    def test_yahoo_failure_falls_back_to_longbridge(self):
        async def inline(fn, *args):
            return fn(*args)
        data = [{'date': '2026-10-26', 'close': 13}]
        with patch.dict(os.environ, {'LONGBRIDGE_OAUTH_CLIENT_ID': 'client'}), \
             patch.object(market_data, 'run_in_threadpool', new=inline), \
             patch.object(market_data, '_longbridge_history', return_value=data), \
             patch.object(market_data, '_yahoo_history', side_effect=RuntimeError()):
            result = asyncio.run(market_data.fetch_us_history('GOOGL.O', '2026-10-24', '2026-10-30'))
        self.assertEqual(result['source'], 'Longbridge')
        self.assertEqual(result['providers_tried'], ['Yahoo Finance', 'Longbridge'])
        self.assertEqual(result['provider_failures'][0]['provider'], 'Yahoo Finance')

    def test_yahoo_success_skips_longbridge(self):
        async def inline(fn, *args):
            return fn(*args)
        data = [{'date': '2026-10-26', 'close': 13}]
        with patch.dict(os.environ, {'LONGBRIDGE_OAUTH_CLIENT_ID': 'client'}), \
             patch.object(market_data, 'run_in_threadpool', new=inline), \
             patch.object(market_data, '_longbridge_history') as longbridge, \
             patch.object(market_data, '_yahoo_history', return_value={'bars': data}):
            result = asyncio.run(market_data.fetch_us_history('GOOGL.O', '2026-10-24', '2026-10-30'))
        self.assertEqual(result['source'], 'Yahoo Finance')
        longbridge.assert_not_called()
