/**
 * SoundSight Built-in STEM Benchmark Library
 * Generates crisp SVG test cards for zero-hardware instant testing
 */

const SOUNDSIGHT_BENCHMARKS = [
  {
    id: "sample_round_robin",
    title: "Round Robin CPU Scheduling",
    topic: "Operating Systems Process Scheduling",
    contentType: "Diagram",
    description: "Preemptive CPU scheduling diagram with Ready Queue, Gantt chart, and preemption loop.",
    rawText: "Round Robin CPU Scheduling Diagram. Ready Queue [P1, P2, P3, P4] -> CPU Core. Time Quantum = 4ms. Gantt Chart: P1 [0-4ms], P2 [4-8ms], P3 [8-12ms]. Preemption feedback loop back to tail of ready queue. Context switch overhead.",
    svgContent: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="800" height="450">
      <rect width="800" height="450" fill="#0A0E17"/>
      <!-- Header -->
      <text x="400" y="45" fill="#FFE600" font-family="sans-serif" font-size="24" font-weight="bold" text-anchor="middle">ROUND ROBIN CPU SCHEDULING</text>
      <text x="400" y="75" fill="#00E5FF" font-family="sans-serif" font-size="16" text-anchor="middle">Time Quantum (q) = 4ms | Preemptive Multitasking</text>
      
      <!-- Ready Queue -->
      <rect x="50" y="140" width="180" height="100" rx="12" fill="#151E2E" stroke="#00E5FF" stroke-width="3"/>
      <text x="140" y="175" fill="#FFFFFF" font-family="sans-serif" font-size="18" font-weight="bold" text-anchor="middle">Ready Queue</text>
      <rect x="70" y="195" width="30" height="30" fill="#25314D" stroke="#FFE600"/><text x="85" y="216" fill="#FFF" font-family="sans-serif" font-size="14" text-anchor="middle">P1</text>
      <rect x="110" y="195" width="30" height="30" fill="#25314D" stroke="#FFE600"/><text x="125" y="216" fill="#FFF" font-family="sans-serif" font-size="14" text-anchor="middle">P2</text>
      <rect x="150" y="195" width="30" height="30" fill="#25314D" stroke="#FFE600"/><text x="165" y="216" fill="#FFF" font-family="sans-serif" font-size="14" text-anchor="middle">P3</text>
      <rect x="190" y="195" width="30" height="30" fill="#25314D" stroke="#FFE600"/><text x="205" y="216" fill="#FFF" font-family="sans-serif" font-size="14" text-anchor="middle">P4</text>

      <!-- Arrow to CPU -->
      <path d="M 230 190 L 330 190" stroke="#FFE600" stroke-width="4" fill="none" marker-end="url(#arrow)"/>
      <text x="280" y="175" fill="#FFF" font-family="sans-serif" font-size="14" text-anchor="middle">Dispatch</text>

      <!-- CPU Core -->
      <rect x="330" y="130" width="160" height="120" rx="12" fill="#1C273B" stroke="#FFE600" stroke-width="4"/>
      <text x="410" y="175" fill="#FFE600" font-family="sans-serif" font-size="20" font-weight="bold" text-anchor="middle">CPU CORE</text>
      <text x="410" y="210" fill="#FFFFFF" font-family="sans-serif" font-size="16" text-anchor="middle">Executing P1</text>

      <!-- Preemption Arc -->
      <path d="M 410 130 C 410 60, 140 60, 140 140" stroke="#00E5FF" stroke-width="3" stroke-dasharray="6,6" fill="none"/>
      <text x="280" y="90" fill="#00E5FF" font-family="sans-serif" font-size="14" text-anchor="middle">Timer Expired: Preempt to Tail</text>

      <!-- Arrow to Exit -->
      <path d="M 490 190 L 590 190" stroke="#00E5FF" stroke-width="4" fill="none"/>
      <rect x="590" y="150" width="140" height="80" rx="12" fill="#151E2E" stroke="#00E5FF" stroke-width="3"/>
      <text x="660" y="195" fill="#FFF" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="middle">Terminated</text>

      <!-- Gantt Chart -->
      <text x="80" y="320" fill="#FFE600" font-family="sans-serif" font-size="16" font-weight="bold">Gantt Execution Timeline:</text>
      <rect x="80" y="335" width="120" height="50" fill="#25314D" stroke="#FFF"/>
      <text x="140" y="365" fill="#FFF" font-family="sans-serif" font-size="16" text-anchor="middle">P1 (4ms)</text>
      <rect x="200" y="335" width="120" height="50" fill="#1E3A5F" stroke="#FFF"/>
      <text x="260" y="365" fill="#FFF" font-family="sans-serif" font-size="16" text-anchor="middle">P2 (4ms)</text>
      <rect x="320" y="335" width="120" height="50" fill="#25314D" stroke="#FFF"/>
      <text x="380" y="365" fill="#FFF" font-family="sans-serif" font-size="16" text-anchor="middle">P3 (4ms)</text>
      <rect x="440" y="335" width="120" height="50" fill="#1E3A5F" stroke="#FFF"/>
      <text x="500" y="365" fill="#FFF" font-family="sans-serif" font-size="16" text-anchor="middle">P1 (4ms)</text>
      <text x="80" y="410" fill="#FFF" font-family="sans-serif" font-size="14">0ms</text>
      <text x="200" y="410" fill="#FFF" font-family="sans-serif" font-size="14">4ms</text>
      <text x="320" y="410" fill="#FFF" font-family="sans-serif" font-size="14">8ms</text>
      <text x="440" y="410" fill="#FFF" font-family="sans-serif" font-size="14">12ms</text>
      <text x="560" y="410" fill="#FFF" font-family="sans-serif" font-size="14">16ms</text>
    </svg>`
  },
  {
    id: "sample_binary_search",
    title: "Binary Search Flowchart",
    topic: "Binary Search Divide-and-Conquer Algorithm",
    contentType: "Flowchart",
    description: "Flowchart depicting binary search decision diamonds, mid calculation, and Yes/No branches.",
    rawText: "Binary Search Flowchart. Start -> low = 0, high = n - 1 -> Decision: Is low <= high? -> Yes: mid = (low + high) / 2 -> Decision: Is arr[mid] == target? -> Yes: Return mid (Target Found) -> No: Is target < arr[mid]? -> Yes: high = mid - 1, No: low = mid + 1 -> Loop back. If low <= high is No -> Return -1 (Target Not Found). End.",
    svgContent: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">
      <rect width="800" height="500" fill="#0A0E17"/>
      <text x="400" y="35" fill="#FFE600" font-family="sans-serif" font-size="22" font-weight="bold" text-anchor="middle">BINARY SEARCH FLOWCHART</text>
      
      <!-- Start Oval -->
      <rect x="330" y="55" width="140" height="45" rx="22" fill="#00E5FF" stroke="#FFF" stroke-width="2"/>
      <text x="400" y="83" fill="#000" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="middle">Start</text>

      <!-- Down Arrow -->
      <line x1="400" y1="100" x2="400" y2="125" stroke="#FFE600" stroke-width="3"/>

      <!-- Process 1: low=0, high=n-1 -->
      <rect x="280" y="125" width="240" height="45" rx="6" fill="#151E2E" stroke="#00E5FF" stroke-width="2"/>
      <text x="400" y="153" fill="#FFF" font-family="sans-serif" font-size="15" text-anchor="middle">low = 0, high = n - 1</text>

      <!-- Down Arrow -->
      <line x1="400" y1="170" x2="400" y2="195" stroke="#FFE600" stroke-width="3"/>

      <!-- Diamond 1: low <= high -->
      <polygon points="400,195 500,240 400,285 300,240" fill="#1C273B" stroke="#FFE600" stroke-width="3"/>
      <text x="400" y="245" fill="#FFF" font-family="sans-serif" font-size="14" font-weight="bold" text-anchor="middle">low &lt;= high?</text>

      <!-- No branch (left) -->
      <line x1="300" y1="240" x2="160" y2="240" stroke="#FF5252" stroke-width="3"/>
      <text x="230" y="230" fill="#FF5252" font-family="sans-serif" font-size="14" font-weight="bold">No</text>
      <rect x="60" y="215" width="100" height="50" rx="25" fill="#FF5252"/>
      <text x="110" y="245" fill="#FFF" font-family="sans-serif" font-size="13" font-weight="bold" text-anchor="middle">Return -1</text>

      <!-- Yes branch (down) -->
      <line x1="400" y1="285" x2="400" y2="320" stroke="#00E5FF" stroke-width="3"/>
      <text x="420" y="305" fill="#00E5FF" font-family="sans-serif" font-size="14" font-weight="bold">Yes</text>

      <!-- Process 2: mid = (low+high)/2 -->
      <rect x="270" y="320" width="260" height="45" rx="6" fill="#151E2E" stroke="#00E5FF" stroke-width="2"/>
      <text x="400" y="348" fill="#FFF" font-family="sans-serif" font-size="15" text-anchor="middle">mid = (low + high) / 2</text>

      <!-- Down Arrow -->
      <line x1="400" y1="365" x2="400" y2="395" stroke="#FFE600" stroke-width="3"/>

      <!-- Diamond 2: arr[mid] == target -->
      <polygon points="400,395 520,440 400,485 280,440" fill="#1C273B" stroke="#FFE600" stroke-width="3"/>
      <text x="400" y="445" fill="#FFF" font-family="sans-serif" font-size="13" font-weight="bold" text-anchor="middle">arr[mid] == target?</text>

      <!-- Yes branch (right) -->
      <line x1="520" y1="440" x2="640" y2="440" stroke="#00E5FF" stroke-width="3"/>
      <text x="560" y="430" fill="#00E5FF" font-family="sans-serif" font-size="14" font-weight="bold">Yes</text>
      <rect x="640" y="415" width="130" height="50" rx="25" fill="#00E5FF"/>
      <text x="705" y="445" fill="#000" font-family="sans-serif" font-size="13" font-weight="bold" text-anchor="middle">Return mid</text>
    </svg>`
  },
  {
    id: "sample_quadratic",
    title: "Quadratic Formula & Root Analysis",
    topic: "Algebraic Polynomial Roots and Discriminant",
    contentType: "Formula",
    description: "Standard quadratic equation formula with discriminant case breakdown.",
    rawText: "Quadratic Formula and Root Equation: x = (-b ± √(b² - 4ac)) / (2a). For ax² + bx + c = 0 where a ≠ 0. Discriminant Δ = b² - 4ac. Cases: Δ > 0 (Two distinct real roots), Δ = 0 (One repeated real root), Δ < 0 (Two complex conjugate roots).",
    svgContent: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="800" height="450">
      <rect width="800" height="450" fill="#0A0E17"/>
      <text x="400" y="45" fill="#FFE600" font-family="sans-serif" font-size="24" font-weight="bold" text-anchor="middle">THE QUADRATIC FORMULA</text>
      <text x="400" y="80" fill="#FFF" font-family="sans-serif" font-size="18" text-anchor="middle">For polynomial equation: a x² + b x + c = 0 (a ≠ 0)</text>

      <!-- Big Formula Box -->
      <rect x="150" y="110" width="500" height="130" rx="16" fill="#151E2E" stroke="#FFE600" stroke-width="4"/>
      <text x="400" y="185" fill="#00E5FF" font-family="serif" font-size="38" font-style="italic" font-weight="bold" text-anchor="middle">x = (-b ± √(b² - 4ac)) / 2a</text>

      <!-- Discriminant Panel -->
      <rect x="100" y="270" width="600" height="140" rx="12" fill="#1C273B" stroke="#00E5FF" stroke-width="2"/>
      <text x="400" y="300" fill="#FFE600" font-family="sans-serif" font-size="18" font-weight="bold" text-anchor="middle">Discriminant Analysis (Δ = b² - 4ac):</text>
      <text x="130" y="335" fill="#FFF" font-family="sans-serif" font-size="16">• Δ &gt; 0 : Two distinct real roots (parabola crosses x-axis twice)</text>
      <text x="130" y="365" fill="#FFF" font-family="sans-serif" font-size="16">• Δ = 0 : Exactly one real repeated root (vertex touches x-axis)</text>
      <text x="130" y="395" fill="#FFF" font-family="sans-serif" font-size="16">• Δ &lt; 0 : Two complex conjugate roots (parabola does not intersect x-axis)</text>
    </svg>`
  },
  {
    id: "sample_python_code",
    title: "Python Bubble Sort Algorithm",
    topic: "Bubble Sort and Array Swapping",
    contentType: "Code",
    description: "Python implementation of bubble sort with nested loops and swap condition.",
    rawText: "def bubble_sort(arr):\n    n = len(arr)\n    for i in range(n - 1):\n        for j in range(0, n - i - 1):\n            if arr[j] > arr[j + 1]:\n                arr[j], arr[j + 1] = arr[j + 1], arr[j]\n    return arr\n\n# Example execution:\nnumbers = [64, 34, 25, 12, 22, 11, 90]\nprint(bubble_sort(numbers))",
    svgContent: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="800" height="450">
      <rect width="800" height="450" fill="#0A0E17"/>
      <text x="40" y="45" fill="#FFE600" font-family="sans-serif" font-size="22" font-weight="bold">PYTHON: BUBBLE SORT ALGORITHM</text>
      <rect x="30" y="65" width="740" height="350" rx="10" fill="#151E2E" stroke="#00E5FF" stroke-width="2"/>
      
      <!-- Code Lines -->
      <g font-family="Consolas, monospace" font-size="16">
        <text x="50" y="105" fill="#6B7280">1</text><text x="80" y="105" fill="#FF5252">def</text><text x="115" y="105" fill="#00E5FF"> bubble_sort</text><text x="215" y="105" fill="#FFF">(arr):</text>
        <text x="50" y="140" fill="#6B7280">2</text><text x="100" y="140" fill="#FFF">n = </text><text x="135" y="140" fill="#FFE600">len</text><text x="165" y="140" fill="#FFF">(arr)</text>
        <text x="50" y="175" fill="#6B7280">3</text><text x="100" y="175" fill="#FF5252">for</text><text x="135" y="175" fill="#FFF"> i </text><text x="155" y="175" fill="#FF5252">in</text><text x="180" y="175" fill="#FFE600"> range</text><text x="235" y="175" fill="#FFF">(n - 1):</text>
        <text x="50" y="210" fill="#6B7280">4</text><text x="130" y="210" fill="#FF5252">for</text><text x="165" y="210" fill="#FFF"> j </text><text x="185" y="210" fill="#FF5252">in</text><text x="210" y="210" fill="#FFE600"> range</text><text x="265" y="210" fill="#FFF">(0, n - i - 1):</text>
        <text x="50" y="245" fill="#6B7280">5</text><text x="160" y="245" fill="#FF5252">if</text><text x="185" y="245" fill="#FFF"> arr[j] &gt; arr[j + 1]:</text>
        <text x="50" y="280" fill="#6B7280">6</text><text x="190" y="280" fill="#00E5FF">arr[j], arr[j + 1] = arr[j + 1], arr[j]</text>
        <text x="50" y="315" fill="#6B7280">7</text><text x="100" y="315" fill="#FF5252">return</text><text x="160" y="315" fill="#FFF"> arr</text>
        <text x="50" y="365" fill="#10B981"># Time: O(n²) Worst/Average | Space: O(1) Auxiliary</text>
        <text x="50" y="395" fill="#FFE600"># Recommendation: Add boolean 'swapped' flag for O(n) best-case.</text>
      </g>
    </svg>`
  },
  {
    id: "sample_ohms_law",
    title: "Ohm's Law & Series Circuit",
    topic: "Electric Circuits and Electrodynamics",
    contentType: "Diagram",
    description: "Closed circuit loop with DC power source and series resistor loads.",
    rawText: "Ohm's Law Series Circuit Diagram. DC Voltage Source V = 12V DC. Series Resistor R1 = 4 Ohms. Current I = V / R = 12 / 4 = 3 Amps. Ground reference at bottom.",
    svgContent: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="800" height="450">
      <rect width="800" height="450" fill="#0A0E17"/>
      <text x="400" y="45" fill="#FFE600" font-family="sans-serif" font-size="24" font-weight="bold" text-anchor="middle">OHM'S LAW: SERIES RESISTOR CIRCUIT</text>
      <text x="400" y="75" fill="#00E5FF" font-family="sans-serif" font-size="16" text-anchor="middle">V = I × R | 12 Volts = 3 Amps × 4 Ohms</text>

      <!-- Circuit Loop Rectangle -->
      <rect x="200" y="120" width="400" height="220" fill="none" stroke="#FFE600" stroke-width="4"/>

      <!-- Voltage Source (Left) -->
      <rect x="180" y="190" width="40" height="80" fill="#0A0E17"/>
      <circle cx="200" cy="230" r="30" fill="#151E2E" stroke="#00E5FF" stroke-width="3"/>
      <text x="200" y="225" fill="#FF5252" font-family="sans-serif" font-size="18" font-weight="bold" text-anchor="middle">+</text>
      <text x="200" y="245" fill="#00E5FF" font-family="sans-serif" font-size="18" font-weight="bold" text-anchor="middle">-</text>
      <text x="130" y="235" fill="#FFF" font-family="sans-serif" font-size="16" font-weight="bold">12V DC</text>

      <!-- Current Arrow -->
      <path d="M 360 110 L 440 110" stroke="#00E5FF" stroke-width="3"/>
      <polygon points="445,110 435,103 435,117" fill="#00E5FF"/>
      <text x="400" y="95" fill="#00E5FF" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="middle">Current I = 3A →</text>

      <!-- Resistor R1 (Top) -->
      <rect x="460" y="110" width="80" height="20" fill="#0A0E17"/>
      <!-- Zigzag -->
      <polyline points="460,120 470,105 480,135 490,105 500,135 510,105 520,135 530,105 540,120" fill="none" stroke="#FFE600" stroke-width="3"/>
      <text x="500" y="90" fill="#FFE600" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="middle">R1 = 4 Ω</text>

      <!-- Ground (Bottom) -->
      <line x1="400" y1="340" x2="400" y2="370" stroke="#FFE600" stroke-width="3"/>
      <line x1="380" y1="370" x2="420" y2="370" stroke="#FFE600" stroke-width="3"/>
      <line x1="388" y1="377" x2="412" y2="377" stroke="#FFE600" stroke-width="2"/>
      <line x1="394" y1="384" x2="406" y2="384" stroke="#FFE600" stroke-width="2"/>
      <text x="400" y="415" fill="#FFF" font-family="sans-serif" font-size="14" text-anchor="middle">Ground (0V)</text>
    </svg>`
  }
];

// Helper to convert SVG string to a Data URL
function svgToDataUrl(svgString) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
}

window.SOUNDSIGHT_BENCHMARKS = SOUNDSIGHT_BENCHMARKS;
window.svgToDataUrl = svgToDataUrl;
