/*
 * Copyright (C) 2024 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2024 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 14 июн. 2018 г.
 *
 * lsp-runtime-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-runtime-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-runtime-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef LSP_PLUG_IN_IO_IINSEQUENCE_H_
#define LSP_PLUG_IN_IO_IINSEQUENCE_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/runtime/LSPString.h>

namespace lsp
{
    namespace io
    {
        class IOutSequence;

        class IInSequence
        {
            protected:
                status_t        nErrorCode;

            protected:
                inline status_t set_error(status_t error) { return nErrorCode = error; }

            public:
                explicit IInSequence();
                IInSequence(const IInSequence &) = delete;
                IInSequence(IInSequence &&) = delete;
                virtual ~IInSequence();

                IInSequence & operator = (const IInSequence &) = delete;
                IInSequence & operator = (IInSequence &&) = delete;

            public:
                /**
                 * Return last error code
                 * @return last error code
                 */
                inline status_t last_error() const  { return nErrorCode; };

                /**
                 * Read amount of characters
                 * @param dst target buffer to read
                 * @param count number of characters to read
                 * @return actual number of characters read or negative value on end of stream
                 */
                virtual ssize_t     read(lsp_wchar_t *dst, size_t count);

                /**
                 * Read single character
                 * @return code of single character or negative value on end of stream
                 */
                virtual lsp_swchar_t    read();

                /**
                 * Read single line
                 * @param s string to store value
                 * @return status of operation
                 */
                virtual status_t    read_line(LSPString *s, bool force = false);

                /**
                 * Skip amount of characters
                 * @param count number of characters to skip
                 * @return number of skipped characters or negative error code
                 */
                virtual ssize_t     skip(size_t count);

                /**
                 * Close input stream
                 * @return status of operation
                 */
                virtual status_t    close();

                /**
                 * Mark position of the input sequence
                 * @param limit the read limit after that the mark becomes invalid,
                 *        negative value is allowed to check support of mark() and reset()
                 *        calls by sequence
                 * @return status of operation
                 *        - STATUS_NOT_SUPPORTED if feature is not supported by this sequence
                 */
                virtual status_t    mark(ssize_t limit);

                /**
                 * Sink all data to the output sequence
                 * @param os pointer to the output stream
                 * @return number of characters processed or negative error code
                 */
                virtual wssize_t    sink(IOutSequence *os, size_t buf_size = 0x1000);

                /**
                 * Reset position to the sequence to previously set mark
                 * @return status of operation
                 *        - STATUS_NOT_FOUND if mark was not set or became invalid
                 *        - STATUS_NOT_SUPPORTED if feature is not supported by this sequence
                 */
                virtual status_t    reset();

        };

    } /* namespace io */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_IO_IINSEQUENCE_H_ */
