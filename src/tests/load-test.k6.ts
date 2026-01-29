import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

/**
 * Load Test for EventWebQueue Application
 * 
 * Scenario: Simulates up to 100 concurrent users
 * - Viewing artist home page
 * - Accessing queue page
 * - Browsing menu
 * - Getting queue tickets (API simulation)
 * 
 * Run with: k6 run src/tests/load-test.k6.ts
 * Or: k6 run --vus 50 --duration 2m src/tests/load-test.k6.ts
 */

// ============================================
// CONFIGURATION
// ============================================

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5173';
const ARTIST_SLUG = __ENV.ARTIST_SLUG || 'test1';
const SUPABASE_URL = __ENV.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = __ENV.SUPABASE_KEY || '';

// ============================================
// CUSTOM METRICS
// ============================================

const pageLoadTime = new Trend('page_load_time', true);
const apiResponseTime = new Trend('api_response_time', true);
const errorRate = new Rate('error_rate');
const successfulRequests = new Counter('successful_requests');
const failedRequests = new Counter('failed_requests');

// ============================================
// TEST OPTIONS
// ============================================

export const options = {
  // Stages: Ramp up to 30 users (realistic for small-medium events)
  stages: [
    { duration: '20s', target: 10 },   // Warm up to 10 users
    { duration: '30s', target: 20 },   // Ramp up to 20 users
    { duration: '1m', target: 30 },    // Ramp up to 30 users (peak load)
    { duration: '1m', target: 30 },    // Hold at 30 users
    { duration: '20s', target: 10 },   // Ramp down to 10
    { duration: '10s', target: 0 },    // Ramp down to 0
  ],
  
  // Thresholds: Define acceptable performance limits
  thresholds: {
    http_req_duration: ['p(95)<2000'],      // 95% of requests < 2s
    http_req_failed: ['rate<0.05'],         // Less than 5% failure rate
    page_load_time: ['p(90)<3000'],         // 90% of pages load < 3s
    api_response_time: ['p(95)<1000'],      // 95% of API calls < 1s
    error_rate: ['rate<0.1'],               // Less than 10% error rate
  },
  
  // Other settings
  noConnectionReuse: false,
  userAgent: 'K6-LoadTest/1.0',
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function checkResponse(response: http.Response, name: string): boolean {
  const passed = check(response, {
    [`${name}: status is 200`]: (r) => r.status === 200,
    [`${name}: response time < 2s`]: (r) => r.timings.duration < 2000,
  });
  
  if (passed) {
    successfulRequests.add(1);
    errorRate.add(0);
  } else {
    failedRequests.add(1);
    errorRate.add(1);
  }
  
  return passed;
}

// ============================================
// MAIN TEST SCENARIO
// ============================================

export default function () {
  // Simulate realistic user behavior with random delays
  
  group('1. View Artist Home Page', () => {
    const start = Date.now();
    const response = http.get(`${BASE_URL}/${ARTIST_SLUG}`);
    const loadTime = Date.now() - start;
    
    pageLoadTime.add(loadTime);
    checkResponse(response, 'Home Page');
    
    // User reads the page
    sleep(Math.random() * 2 + 1); // 1-3 seconds
  });

  group('2. Navigate to Queue Page', () => {
    const start = Date.now();
    const response = http.get(`${BASE_URL}/${ARTIST_SLUG}/queue`);
    const loadTime = Date.now() - start;
    
    pageLoadTime.add(loadTime);
    checkResponse(response, 'Queue Page');
    
    // User checks queue status
    sleep(Math.random() * 3 + 2); // 2-5 seconds
  });

  group('3. Browse Menu Page', () => {
    const start = Date.now();
    const response = http.get(`${BASE_URL}/${ARTIST_SLUG}/menu`);
    const loadTime = Date.now() - start;
    
    pageLoadTime.add(loadTime);
    checkResponse(response, 'Menu Page');
    
    // User browses products
    sleep(Math.random() * 5 + 3); // 3-8 seconds
  });

  // Simulate API calls (if Supabase URL is provided)
  if (SUPABASE_URL && SUPABASE_KEY) {
    group('4. API: Fetch Artist Data', () => {
      const start = Date.now();
      const response = http.get(
        `${SUPABASE_URL}/rest/v1/artists?slug=eq.${ARTIST_SLUG}&select=*`,
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
          },
        }
      );
      const responseTime = Date.now() - start;
      
      apiResponseTime.add(responseTime);
      checkResponse(response, 'API: Fetch Artist');
    });

    group('5. API: Fetch Products', () => {
      const start = Date.now();
      const response = http.get(
        `${SUPABASE_URL}/rest/v1/products?select=*&limit=50`,
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
          },
        }
      );
      const responseTime = Date.now() - start;
      
      apiResponseTime.add(responseTime);
      checkResponse(response, 'API: Fetch Products');
    });

    group('6. API: Fetch Active Events', () => {
      const start = Date.now();
      const response = http.get(
        `${SUPABASE_URL}/rest/v1/events?status=eq.Confirmed&select=*`,
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
          },
        }
      );
      const responseTime = Date.now() - start;
      
      apiResponseTime.add(responseTime);
      checkResponse(response, 'API: Fetch Events');
    });
  }

  // Think time between iterations
  sleep(Math.random() * 2 + 1);
}

// ============================================
// LIFECYCLE HOOKS
// ============================================

export function setup() {
  console.log('🚀 Load Test Starting...');
  console.log(`   Target: ${BASE_URL}/${ARTIST_SLUG}`);
  console.log(`   Max VUs: 30`);
  
  // Verify target is accessible
  const response = http.get(`${BASE_URL}/${ARTIST_SLUG}`);
  if (response.status !== 200) {
    console.error(`❌ Target unreachable! Status: ${response.status}`);
    throw new Error('Target URL is not accessible');
  }
  
  console.log('✅ Target is accessible. Starting load test...');
  return { startTime: Date.now() };
}

export function teardown(data: { startTime: number }) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`\n🏁 Load Test Completed in ${duration.toFixed(1)} seconds`);
  console.log('📊 Check the summary above for detailed metrics.');
}

// ============================================
// SPIKE TEST SCENARIO (Optional)
// ============================================

export function spikeTest() {
  // Sudden spike of traffic
  group('Spike: Simultaneous Page Load', () => {
    const responses = http.batch([
      ['GET', `${BASE_URL}/${ARTIST_SLUG}`],
      ['GET', `${BASE_URL}/${ARTIST_SLUG}/queue`],
      ['GET', `${BASE_URL}/${ARTIST_SLUG}/menu`],
    ]);
    
    responses.forEach((response, index) => {
      const pages = ['Home', 'Queue', 'Menu'];
      checkResponse(response, `Spike-${pages[index]}`);
    });
  });
}
