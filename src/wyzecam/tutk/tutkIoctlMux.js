import { CDLL, c_int } from 'ctypes';
import { Empty, Queue } from 'queue';
import { TutkWyzeProtocolMessage } from './tutk_protocol';
import tutk, { TutkError } from './tutk';
import tutk_protocol, { TutkWyzeProtocolHeader } from './tutk_protocol';
import contextlib from 'contextlib';
import logging from 'logging';
import threading from 'threading';
import time from 'time';
import { defaultdict } from 'collections';

const STOP_SENTINEL = {};
const CONTROL_CHANNEL = "CONTROL";
const logger = logging.getLogger(__name__);

class TutkIOCtrlFuture {
    constructor(req, queue=null, errcode=null) {
        this.req = req;
        this.queue = queue;
        this.expected_response_code = req.expected_response_code;
        this.errcode = errcode;
        this.io_ctl_type = null;
        this.resp_protocol = null;
        this.resp_data = null;
    }

    assert(condition, message) {
        if (!condition) {
            throw message || "Assertion failed";
        }
    }

    result(block=true, timeout=10000) {
        if (this.resp_data !== null) {
            return this.req.parse_response(this.resp_data);
        }
        if (this.errcode) {
            throw new tutk.TutkError(this.errcode);
        }
        if (this.expected_response_code === null) {
            logger.warning("no response code!");
            return;
        }
        //Throw error
        if (this.queue !== null) this.assert(true, "Future created without error nor queue!");
        const msg = this.queue.get(block=block, timeout=timeout);
        //Throw error
        if (isinstance(msg, tuple)) this.assert(true, "Expected a iotc result, instead got sentinel!");
        const [actual_len, io_ctl_type, resp_protocol, data] = msg;
        if (actual_len < 0) {
            throw new tutk.TutkError(this.errcode);
        }
        this.io_ctl_type = io_ctl_type;
        this.resp_protocol = resp_protocol;
        this.resp_data = data;
        return this.req.parse_response(data);
    }

    __repr__() {
        const errcode_str = this.errcode ? ` errcode=${this.errcode}` : "";
        const data_str = this.resp_data ? ` resp_data=${repr(this.resp_data)}` : "";
        return `<TutkIOCtlFuture req=${this.req}${errcode_str}${data_str}>`;
    }
}

class TutkIOCtrlMux {
    constructor(tutk_platform_lib, av_chan_id) {
        this.tutk_platform_lib = tutk_platform_lib;
        this.av_chan_id = av_chan_id;
        this.queues = defaultdict(Queue);
        this.listener = new TutkIOCtrlMuxListener(tutk_platform_lib, av_chan_id, this.queues);
    }

    start_listening() {
        this.listener.start();
    }

    stop_listening() {
        this.queues[CONTROL_CHANNEL].put(STOP_SENTINEL);
        this.listener.join();
    }

    __enter__() {
        this.start_listening();
        return this;
    }

    __exit__(exc_type, exc_val, exc_tb) {
        this.stop_listening();
    }

    send_ioctl(msg, ctrl_type=tutk.IOTYPE_USER_DEFINED_START) {
        const encoded_msg = msg.encode();
        const encoded_msg_header = tutk_protocol.TutkWyzeProtocolHeader.from_buffer_copy(encoded_msg.slice(0, 16));
        logger.debug("SEND %s %s %s", msg, encoded_msg_header, encoded_msg.slice(16));
        const errcode = tutk.av_send_io_ctrl(this.tutk_platform_lib, this.av_chan_id, ctrl_type, encoded_msg);
        if (errcode) {
            return new TutkIOCtrlFuture(msg, errcode=errcode);
        }
        if (!msg.expected_response_code) {
            logger.warning("no expected response code found");
            return new TutkIOCtrlFuture(msg);
        }
        return new TutkIOCtrlFuture(msg, this.queues[msg.expected_response_code]);
    }

    waitfor(futures, timeout=null) {
        let unwrap_single_item = false;
        if (futures instanceof TutkIOCtrlFuture) {
            futures = [futures];
            unwrap_single_item = true;
        }
        const results = Array(futures.length).fill(null);
        const start = time.time();
        while ((timeout === null || time.time() - start <= timeout) && results.some(result => result === null)) {
            let all_success = true;
            for (let i = 0; i < futures.length; i++) {
                const future = futures[i];
                if (results[i] !== null) {
                    continue;
                }
                try {
                    const result = future.result(block=false);
                    results[i] = result;
                } catch (Empty) {
                    all_success = false;
                }
            }
            if (!all_success) {
                time.sleep(0.1);
            }
        }
        if (unwrap_single_item) {
            return results[0];
        } else {
            return results;
        }
    }
}

class TutkIOCtrlMuxListener extends threading.Thread {
    constructor(tutk_platform_lib, av_chan_id, queues) {
        super();
        this.tutk_platform_lib = tutk_platform_lib;
        this.av_chan_id = av_chan_id;
        this.queues = queues;
        this.exception = null;
    }

    join(timeout=null) {
        super.join(timeout);
        if (this.exception) {
            throw this.exception;
        }
    }

    run() {
        const timeout_ms = 1000;
        logger.debug(`Now listening on channel id ${this.av_chan_id}`);
        while (true) {
            with contextlib.suppress(Empty) {
                const control_channel_command = this.queues[CONTROL_CHANNEL].get_nowait();
                if (control_channel_command === STOP_SENTINEL) {
                    logger.debug(`No longer listening on channel id ${this.av_chan_id}`);
                    return;
                }
            }
            const [actual_len, io_ctl_type, data] = tutk.av_recv_io_ctrl(this.tutk_platform_lib, this.av_chan_id, timeout_ms);
            if (actual_len === tutk.AV_ER_TIMEOUT) {
                continue;
            } else if (actual_len === tutk.AV_ER_SESSION_CLOSE_BY_REMOTE) {
                logger.warning("Connection closed by remote. Closing connection.");
                break;
            } else if (actual_len === tutk.AV_ER_REMOTE_TIMEOUT_DISCONNECT) {
                logger.warning("Connection closed because of no response from remote.");
                break;
            } else if (actual_len < 0) {
                this.exception = new tutk.TutkError(actual_len);
                break;
            }
            const [header, payload] = tutk_protocol.decode(data);
            logger.debug(`RECV ${header}: ${repr(payload)}`);
            this.queues[header.code].put([actual_len, io_ctl_type, header.protocol, payload]);
        }
    }
}


