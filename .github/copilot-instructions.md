# Copilot Instructions for OT & Fabrication Engineering

As an OT (Operational Technology) Engineer working in a fabrication facility, your code and automation scripts must prioritize safety, deterministic performance, and long-term maintainability over "cutting-edge" volatility.

## Core Architectural Principles
* **Safety First:** Scripts interacting with physical hardware (PLCs, CNCs, Robotics) must include explicit "Fail-Safe" logic and state validation.
* **Deterministic Reliability:** Favor synchronous operations or well-defined timeouts when dealing with fieldbus protocols (Modbus, OPC-UA, EtherNet/IP).
* **Isolation:** Design systems to operate in "Air-Gapped" or restricted network environments. Minimize external dependencies.

## Coding Standards
* **Error Handling:** Use exhaustive try-catch blocks. Every hardware interaction MUST have a timeout and a retry limit.
* **Logging:** Implement robust, timestamped logging for audit trails. Use standard industry formats (ISO 8601).
* **Legacy Compatibility:** When working with older systems, use primitive data types and avoid modern syntactic sugar that may not be supported by embedded runtimes.

## Preferred Frameworks & Protocols
* **Communication:** `node-opcua`, `modbus-serial`, `mqtt`.
* **Data Interchange:** Favor JSON for configuration but use binary buffers (`Buffer`) for raw socket communication with legacy equipment.
* **UI:** For HMI (Human Machine Interface) prototypes, use high-contrast, touch-friendly layouts.

## Security (OT-Specific)
* **No Hardcoded Credentials:** Use environment variables or secure local vaults for PLC passwords.
* **Network Validation:** Always verify the IP range before initiating a write command to a subnet to avoid accidental cross-talk between production lines.

## Documentation Requirements
* Every function that triggers a physical movement MUST be preceded by a comment block explaining the physical impact and safety precautions.
* Use ISA-95 terminology for layering (Level 0-4) in architectural descriptions.
